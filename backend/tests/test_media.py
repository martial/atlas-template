import io
import subprocess
from types import SimpleNamespace

import numpy as np
from PIL import Image
from pypdf import PdfWriter

from atlas.ai import VertexAI
from atlas.config import Settings
from atlas.media import prepare, validate
from atlas.projection import project


def test_image_and_pdf_normalization(tmp_path):
    image_path = tmp_path / "transparent.webp"
    Image.new("RGBA", (40, 20), (30, 120, 90, 255)).save(image_path)
    assert validate(image_path, image_path.name) == ("image", "image/webp")
    segment = list(prepare(image_path, "image", "image/webp", tmp_path, 10))[0]
    assert segment.mime == "image/jpeg" and segment.thumbnail
    with Image.open(io.BytesIO(segment.thumbnail)) as thumb:
        assert thumb.size == (40, 20)
    pdf_path = tmp_path / "pages.pdf"
    pdf = PdfWriter()
    pdf.add_blank_page(width=100, height=100)
    pdf.add_blank_page(width=100, height=100)
    pdf.write(pdf_path)
    assert validate(pdf_path, "pages.pdf")[1] == "application/pdf"
    segments = list(prepare(pdf_path, "document", "application/pdf", tmp_path, 10))
    assert [s.location["page"] for s in segments] == [1, 2]


def test_video_embeds_visuals_and_audio_separately(tmp_path):
    video = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac",
                    "-shortest", str(video)], check=True)
    assert validate(video, "clip.mp4")[0] == "video"
    segments = list(prepare(video, "video", "video/mp4", tmp_path, 10))
    assert {s.location["modality"] for s in segments} == {"video", "audio"}
    assert segments[0].thumbnail and segments[0].location["start"] == 0
    assert all(s.path.stat().st_size > 0 for s in segments)


def test_sdk_contract_uses_embedding2_prefixes_and_inline_media():
    calls = []
    class Models:
        def embed_content(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(embeddings=[SimpleNamespace(values=[1.] * 768)])
    settings = Settings(_env_file=None)
    ai = VertexAI(settings, lambda: None)
    ai._client = SimpleNamespace(models=Models())
    assert np.isclose(np.linalg.norm(ai.embed(text="water", query=True)), 1)
    assert calls[-1]["contents"] == "task: search result | query: water"
    assert calls[-1]["config"].task_type is None
    ai.embed(data=b"test image bytes", mime="image/jpeg")
    assert calls[-1]["contents"].parts[0].inline_data.mime_type == "image/jpeg"
    assert calls[-1]["config"].output_dimensionality == 768


def test_projection_returns_finite_coordinates_and_small_set_fallback():
    points, edges, method = project([[1, 0, 0], [0, 1, 0]])
    assert "PCA" in method
    assert np.isfinite(points).all()
    assert len(points) == 2 and len(points[0]) == 3
    duplicate, _, _ = project([[1, 0], [1, 0]])
    assert np.asarray(duplicate).sum() == 0
