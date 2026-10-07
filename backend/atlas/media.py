"""Bounded preprocessing. The original source is never passed as a shell command."""
import io
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps
from pypdf import PdfReader, PdfWriter

from .errors import AtlasError

PREPROCESS_VERSION = "v1-text12000-pdf1-video20-audio90"
FORMATS = {
    ".jpg": ("image", "image/jpeg"), ".jpeg": ("image", "image/jpeg"),
    ".png": ("image", "image/png"), ".webp": ("image", "image/webp"),
    ".mp4": ("video", "video/mp4"), ".mov": ("video", "video/quicktime"),
    ".mp3": ("audio", "audio/mpeg"), ".wav": ("audio", "audio/wav"),
    ".pdf": ("document", "application/pdf"), ".md": ("document", "text/markdown"),
    ".txt": ("document", "text/plain"),
}
Image.MAX_IMAGE_PIXELS = 40_000_000


def run(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, timeout=240).stdout
    except FileNotFoundError as error:
        raise AtlasError("Install ffmpeg and ffprobe to process audio and video.") from error
    except (subprocess.SubprocessError, OSError) as error:
        raise AtlasError("This media could not be decoded within the processing limit.") from error


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format",
                           "-show_streams", "-of", "json", str(path)]))


def validate(path: Path, name: str):
    ext = Path(name).suffix.lower()
    if ext not in FORMATS:
        raise AtlasError("Unsupported file type. Use an image, MP4/MOV, MP3/WAV, PDF, Markdown, or text.")
    kind, mime = FORMATS[ext]
    try:
        if kind == "image":
            with Image.open(path) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise AtlasError("Image content does not match a supported format.")
                image.verify()
        elif mime == "application/pdf":
            pdf = PdfReader(path)
            if pdf.is_encrypted or not len(pdf.pages):
                raise AtlasError("Use a nonempty, unencrypted PDF.")
        elif kind in {"audio", "video"}:
            info = probe(path)
            media_types = {s.get("codec_type") for s in info.get("streams", [])}
            if kind not in media_types:
                raise AtlasError(f"This file contains no {kind} stream.")
            duration = float(info.get("format", {}).get("duration", 0))
            if not math.isfinite(duration) or duration <= 0:
                raise AtlasError("This media has no valid duration.")
            allowed = {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"} if kind == "video" else {"mp3", "wav"}
            if not set(info["format"]["format_name"].split(",")) & allowed:
                raise AtlasError("The actual media format is not supported.")
        else:
            text = path.read_text(encoding="utf-8")
            if "\x00" in text or not text.strip():
                raise AtlasError("Use a nonempty UTF-8 text file.")
    except AtlasError:
        raise
    except Exception as error:
        raise AtlasError("The file is corrupt, unsupported, or does not match its extension.") from error
    return kind, mime


@dataclass
class Segment:
    text: str
    location: dict
    path: Path | None = None
    mime: str | None = None
    thumbnail: bytes | None = None


def text_segments(text, location=None):
    for offset in range(0, len(text), 11000):
        part = text[offset:offset + 12000].strip()
        if part:
            yield Segment(part, {**(location or {}), "offset": offset, "modality": "text"})


def jpeg(image, size):
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail(size)
    data = io.BytesIO()
    image.save(data, format="JPEG", quality=85)
    return data.getvalue()


def prepare(path: Path, kind: str, mime: str, directory: Path, max_chunks: int):
    if kind == "image":
        with Image.open(path) as image:
            data = jpeg(image, (2048, 2048))
        with Image.open(io.BytesIO(data)) as image:
            thumbnail = jpeg(image, (520, 520))
        normalized = directory / "image.jpg"
        normalized.write_bytes(data)
        yield Segment("", {"modality": "image"}, normalized, "image/jpeg", thumbnail)
    elif mime == "application/pdf":
        reader = PdfReader(path)
        if len(reader.pages) > max_chunks:
            raise AtlasError(f"PDF exceeds the {max_chunks}-page processing limit.")
        for i, page in enumerate(reader.pages):
            text = (page.extract_text() or "").strip()
            if len(text) > 12000:
                yield from text_segments(text, {"page": i + 1})
            else:
                writer = PdfWriter()
                writer.add_page(page)
                part = directory / f"page-{i}.pdf"
                writer.write(part)
                if part.stat().st_size > 10 * 1024 * 1024:
                    raise AtlasError("A PDF page exceeds 10 MB. Optimize that PDF before indexing.")
                yield Segment(text, {"page": i + 1, "modality": "document"}, part, mime)
    elif kind == "document":
        text = path.read_text(encoding="utf-8")
        if math.ceil(len(text) / 11000) > max_chunks:
            raise AtlasError(f"Text exceeds the {max_chunks}-passage processing limit.")
        yield from text_segments(text)
    else:
        info = probe(path)
        duration = float(info["format"]["duration"])
        has_audio = any(s.get("codec_type") == "audio" for s in info["streams"])
        length = 20 if kind == "video" else 90
        stride = length - 2
        count = math.ceil(duration / stride) * (2 if kind == "video" and has_audio else 1)
        if count > max_chunks:
            raise AtlasError(f"Media exceeds the {max_chunks}-segment processing limit.")
        for i, start in enumerate(range(0, math.ceil(duration), stride)):
            end = min(start + length, duration)
            base = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
                    "-ss", str(start), "-i", str(path), "-t", str(end - start)]
            if kind == "video":
                part = directory / f"video-{i}.mp4"
                run(base + ["-an", "-vf", "scale=512:512:force_original_aspect_ratio=decrease:force_divisible_by=2",
                            "-r", "6", "-c:v", "libx264", "-preset", "fast", "-crf", "28", "-movflags",
                            "+faststart", str(part)])
                frame = directory / f"frame-{i}.jpg"
                run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(part),
                     "-frames:v", "1", "-update", "1", str(frame)])
                yield Segment("", {"start": start, "end": end, "modality": "video"}, part,
                              "video/mp4", frame.read_bytes())
            if has_audio:
                part = directory / f"audio-{i}.mp3"
                run(base + ["-vn", "-ac", "1", "-ar", "24000", "-b:a", "64k", str(part)])
                yield Segment("", {"start": start, "end": end, "modality": "audio"}, part, "audio/mpeg")
