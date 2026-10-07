import hashlib
import io
import json
import logging
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from .ai import VertexAI, OfflineAI, consume
from .errors import AtlasError, Superseded
from .media import FORMATS, PREPROCESS_VERSION, prepare, validate
from .objects import CloudObjects, LocalObjects
from .projection import project
from .repository import Repository
from .retrieval import cited_sources, overview_sources, spread

log = logging.getLogger(__name__)


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid.uuid4().hex


def error_message(error):
    if isinstance(error, AtlasError):
        return str(error)
    # Provider exception strings can contain request URLs and credentials.
    log.error("Operation failed: %s", type(error).__name__)
    return "Processing failed. Check server logs and provider configuration, then retry."


class Service:
    def __init__(self, settings, repo=None, objects=None, ai=None):
        self.settings = settings
        self.repo = repo if repo is not None else Repository(settings)
        self.objects = objects if objects is not None else (LocalObjects(settings.data_dir)
            if settings.storage == "local" else CloudObjects(settings.project, settings.bucket))
        self.ai = ai or (OfflineAI(settings.dimensions) if settings.provider == "offline" else
                         VertexAI(settings, lambda: consume(self.repo, "ai-" + now()[:10], settings.daily_ai_calls)))
        self.cache = {}
        self.cache_lock = threading.Lock()

    def required(self, kind, id):
        value = self.repo.get(kind, id)
        if not value or value.get("deleted"):
            raise AtlasError(f"{kind} not found.", 404)
        return value

    def collections(self):
        return sorted(self.repo.list("Collection"), key=lambda c: c["created"])

    def create_collection(self, name, description=""):
        id = uid()
        return self.repo.put("Collection", id, {"id": id, "name": name.strip(),
            "description": description.strip(), "created": now(), "snapshot": None, "active_job": None})

    def assets(self, collection):
        self.required("Collection", collection)
        return [a for a in self.repo.list("Asset", collection) if not a.get("deleted")]

    def public_asset(self, asset):
        result = {k: asset[k] for k in ("id", "collection", "name", "kind", "mime", "size", "created",
                  "revision", "status", "description", "chunks", "tags", "group", "detail")}
        result.update(url=f'/api/v1/assets/{asset["id"]}/preview?r={asset["revision"]}')
        if asset.get("thumbnail") or asset["kind"] == "image":
            result["image"] = f'/api/v1/assets/{asset["id"]}/thumbnail?r={asset["revision"]}'
        if asset.get("error"):
            result["error"] = asset["error"]
        return result

    def reserve_upload(self, collection, name, size, replace=None):
        self.required("Collection", collection)
        name = Path(name.replace("\\", "/")).name.strip()[:240]
        ext = Path(name).suffix.lower()
        if not name or ext not in FORMATS:
            raise AtlasError("Unsupported filename or file type.")
        if not 0 < size <= self.settings.max_upload_mb * 1024 * 1024:
            raise AtlasError(f"Use a nonempty file up to {self.settings.max_upload_mb} MB.", 413)
        previous = self.required("Asset", replace) if replace else None
        if previous and previous["collection"] != collection:
            raise AtlasError("That asset belongs to a different collection.", 409)
        if not replace and len(self.assets(collection)) >= self.settings.max_assets:
            raise AtlasError("Collection file limit reached.", 429)
        consume(self.repo, "uploads-" + now()[:10], self.settings.upload_sessions_per_day)
        id, asset = uid(), replace or uid()
        kind, mime = FORMATS[ext]
        record = {"id": id, "collection": collection, "asset": asset, "name": name, "kind": kind,
                  "mime": mime, "size": size, "base_revision": previous["revision"] if previous else 0,
                  "key": f"sources/{collection}/{asset}/{id}{ext}", "expires": time.time() + 3600,
                  "state": "reserved"}
        self.repo.put("Upload", id, record)
        if self.settings.storage == "gcs":
            url = self.objects.upload_session(record["key"], mime, size, self.settings.public_url)
        else:
            url = f"/api/v1/uploads/{id}/bytes"
        return {"id": id, "asset_id": asset, "url": url, "method": "PUT", "mime": mime,
                "transport": self.settings.storage}

    def upload_record(self, id):
        upload = self.required("Upload", id)
        if upload["expires"] < time.time():
            raise AtlasError("Upload session expired. Start a new upload.", 410)
        return upload

    def complete_upload(self, id):
        upload = self.upload_record(id)
        if upload["state"] == "complete":
            return self.public_asset(self.required("Asset", upload["asset"]))
        if upload["state"] == "receiving":
            raise AtlasError("Upload is still receiving bytes.", 409)
        size = self.objects.size(upload["key"])
        if size != upload["size"]:
            raise AtlasError("Uploaded size does not match the reserved file.")
        with TemporaryDirectory() as temp:
            source = Path(temp) / upload["name"]
            self.objects.download(upload["key"], source)
            kind, mime = validate(source, upload["name"])
            with source.open("rb") as file:
                digest = hashlib.file_digest(file, "sha256").hexdigest()
        def change(old):
            if old and old.get("upload_id") == id:
                return old
            if (old and old.get("deleted")) or (old or {}).get("revision", 0) != upload["base_revision"]:
                raise Superseded()
            # Identical replacement is a true no-op, including embedding calls.
            if old and old.get("sha256") == digest:
                return {**old, "name": upload["name"], "upload_id": id}
            return {"id": upload["asset"], "collection": upload["collection"], "name": upload["name"],
                "size": size, "kind": kind, "mime": mime, "source": upload["key"], "sha256": digest,
                "revision": upload["base_revision"] + 1, "status": "pending", "created": now(),
                "description": "Waiting to be indexed.", "tags": [], "chunks": 0,
                "group": {"image": 0, "video": 1, "audio": 2, "document": 3}[kind],
                "detail": Path(upload["name"]).suffix[1:].upper(), "upload_id": id}
        asset = self.repo.mutate("Asset", upload["asset"], change)
        self.repo.mutate("Upload", id, lambda old: {**old, "state": "complete"})
        if asset["source"] != upload["key"]:
            self.objects.delete(upload["key"])
        return self.public_asset(asset)

    def delete_asset(self, id):
        def change(old):
            if not old:
                raise AtlasError("Asset not found.", 404)
            return {**old, "deleted": True, "revision": old["revision"] + 1, "status": "deleted"}
        # Tombstone first: stale snapshots, concurrent workers and preview routes exclude it immediately.
        old = self.repo.mutate("Asset", id, change)
        for key in (old.get("source"), old.get("thumbnail")):
            if key:
                self.objects.delete(key)

    def index_key(self, asset):
        s = self.settings
        value = [asset["sha256"], PREPROCESS_VERSION, s.provider, s.embedding_model, s.answer_model, s.dimensions]
        return hashlib.sha256(json.dumps(value).encode()).hexdigest()

    def estimate(self, collection):
        assets = self.assets(collection)
        pending = [a for a in assets if a.get("index_key") != self.index_key(a) or a["status"] != "indexed"]
        return {"files": len(pending), "unchanged": len(assets) - len(pending),
                "bytes": sum(a["size"] for a in pending), "max_segments_per_file": self.settings.max_file_chunks,
                "max_ai_calls": len(pending) * self.settings.max_file_chunks * 3,
                "provider": self.settings.provider,
                "note": "Upper bound; actual calls depend on duration and pages. Unchanged files use the cache."}

    def start_job(self, collection):
        # Job exists before its ID can be observed on the collection.
        id = uid()
        job = {"id": id, "collection": collection, "state": "queued", "created": now(),
               "completed": 0, "total": 0, "errors": [], "message": "Waiting for worker"}
        self.repo.put("IndexJob", id, job)
        def lock(old):
            if not old:
                raise AtlasError("Collection not found.", 404)
            if old.get("active_job") and old.get("lease_until", 0) > time.time():
                return old
            return {**old, "active_job": id, "lease_until": time.time() + self.settings.lease_seconds}
        state = self.repo.mutate("Collection", collection, lock)
        if state["active_job"] != id:
            self.repo.mutate("IndexJob", id, lambda _: None)
            return self.required("IndexJob", state["active_job"]), False
        return job, True

    def dispatch_failed(self, job, error):
        self.repo.mutate("IndexJob", job["id"], lambda old: {**old, "state": "failed", "message": error_message(error)})
        self.repo.mutate("Collection", job["collection"], lambda old: {**old, "active_job": None}
                         if old.get("active_job") == job["id"] else old)

    def job_status(self, id):
        job = self.required("IndexJob", id)
        if job["state"] in {"queued", "running"}:
            collection = self.required("Collection", job["collection"])
            if collection.get("active_job") == id and collection.get("lease_until", 0) < time.time():
                def expire(old):
                    if old.get("active_job") == id and old.get("lease_until", 0) < time.time():
                        return {**old, "active_job": None, "expired_job": id}
                    return old
                current = self.repo.mutate("Collection", job["collection"], expire)
                if current.get("expired_job") == id:
                    job = self.repo.mutate("IndexJob", id, lambda old: {**old, "state": "failed",
                        "message": "Worker lease expired. Start another update to resume cached work."}
                        if old["state"] in {"queued", "running"} else old)
                else:
                    job = self.required("IndexJob", id)
        return {k: v for k, v in job.items() if k != "token"}

    def run_job(self, id):
        job = self.required("IndexJob", id)
        collection, token = job["collection"], uid()
        def claim(old):
            if old["state"] not in {"queued", "running"}:
                raise Superseded()
            if old["state"] == "running" and old.get("lease_until", 0) > time.time():
                raise Superseded()
            return {**old, "state": "running", "token": token, "lease_until": time.time() + self.settings.lease_seconds}
        try:
            self.repo.mutate("IndexJob", id, claim)
        except Superseded:
            return
        stop = threading.Event()
        lost = threading.Event()
        def heartbeat():
            def extend(old):
                if old.get("active_job") != id:
                    raise Superseded()
                return {**old, "lease_until": time.time() + self.settings.lease_seconds}
            self.repo.mutate("Collection", collection, extend)
            def touch(old):
                if old.get("token") != token:
                    raise Superseded()
                return {**old, "lease_until": time.time() + self.settings.lease_seconds}
            self.repo.mutate("IndexJob", id, touch)
        def keep_alive():
            while not stop.wait(30):
                try:
                    heartbeat()
                except Exception:
                    lost.set()
                    return
        thread = threading.Thread(target=keep_alive, daemon=True)
        errors, changed = [], False
        try:
            heartbeat()
            thread.start()
            assets = self.assets(collection)
            total = len(assets)
            for i, asset in enumerate(assets):
                if lost.is_set():
                    raise Superseded()
                self.repo.mutate("IndexJob", id, lambda old: {**old, "total": total, "completed": i,
                                                             "message": f'Indexing {asset["name"]}'})
                try:
                    changed |= self.index_asset(asset, lost)
                except Superseded:
                    continue
                except Exception as error:
                    message = error_message(error)
                    errors.append({"asset": asset["id"], "name": asset["name"], "message": message})
                    self.repo.mutate("Asset", asset["id"], lambda old: {**old, "status": "error", "error": message}
                        if old and not old.get("deleted") and old["revision"] == asset["revision"] else old)
            self.repo.mutate("IndexJob", id, lambda old: {**old, "completed": total,
                "message": "Computing 2D and 3D maps"})
            current = self.required("Collection", collection)
            snapshot = current.get("snapshot")
            # Even a no-op update republishes after deletions, but never calls the AI again.
            if changed or not snapshot or self.snapshot_stale(collection, snapshot):
                snapshot = self.build_snapshot(collection)
            if lost.is_set():
                raise Superseded()
            def publish(old):
                if old.get("active_job") != id:
                    raise Superseded()
                return {**old, "snapshot": snapshot, "active_job": None, "updated": now()}
            self.repo.mutate("Collection", collection, publish)
            self.repo.mutate("IndexJob", id, lambda old: {**old, "state": "completed", "completed": total,
                "total": total, "errors": errors, "snapshot": snapshot, "finished": now(),
                "message": f"Index ready. {len(errors)} file(s) need attention." if errors else "Index up to date."})
        except Exception as error:
            self.dispatch_failed(job, error)
        finally:
            stop.set()
            if thread.is_alive():
                thread.join(timeout=2)

    def index_asset(self, asset, lost):
        key = self.index_key(asset)
        if asset.get("index_key") == key and asset["status"] == "indexed":
            return False
        result_key = f'indexes/{asset["id"]}/{key}/result.json'
        try:
            result = json.loads(self.objects.get(result_key))
        except Exception as error:
            from google.api_core.exceptions import NotFound
            if not isinstance(error, (FileNotFoundError, NotFound)):
                raise
            chunks = []
            with TemporaryDirectory() as temp:
                directory = Path(temp)
                source = directory / ("source" + Path(asset["name"]).suffix)
                self.objects.download(asset["source"], source)
                for i, segment in enumerate(prepare(source, asset["kind"], asset["mime"], directory,
                                                     self.settings.max_file_chunks)):
                    if lost.is_set():
                        raise Superseded()
                    if i >= self.settings.max_file_chunks:
                        raise AtlasError("File segment limit exceeded. Split this file before indexing.")
                    # Persist each completed segment, so retries reuse already-paid model calls.
                    segment_key = f'indexes/{asset["id"]}/{key}/segment-{i}.json'
                    try:
                        chunk = json.loads(self.objects.get(segment_key))
                    except (FileNotFoundError, NotFound):
                        data = segment.path.read_bytes() if segment.path else None
                        if data and len(data) > 12 * 1024 * 1024:
                            raise AtlasError("A normalized media segment exceeds 12 MB.")
                        text = segment.text
                        if data and (not text or segment.mime != "application/pdf"):
                            if self.settings.provider == "offline":
                                raise AtlasError("Offline mode supports text and Markdown. Configure Gemini for media.")
                            text = self.ai.describe(data, segment.mime)
                        vector = self.ai.embed(text=text, data=data, mime=segment.mime, title=asset["name"])
                        description_vector = self.ai.embed(text=text, title=asset["name"]) if data else vector
                        thumb_key = None
                        if segment.thumbnail:
                            thumb_key = f'indexes/{asset["id"]}/{key}/thumb-{i}.jpg'
                            self.objects.put(thumb_key, segment.thumbnail, "image/jpeg")
                        chunk = {"id": f'{asset["id"]}:{key[:12]}:{i}', "asset": asset["id"], "part": i,
                            "text": text[:12000], "location": segment.location, "thumbnail": thumb_key,
                            "vector": vector.tolist(), "text_vector": description_vector.tolist()}
                        self.objects.put(segment_key, json.dumps(chunk).encode(), "application/json")
                    chunks.append(chunk)
                if not chunks:
                    raise AtlasError("No indexable content was found.")
            result = {"chunks": chunks, "index_key": key}
            self.objects.put(result_key, json.dumps(result).encode(), "application/json")
        if lost.is_set():
            raise Superseded()
        def commit(old):
            if not old or old.get("deleted") or old["revision"] != asset["revision"]:
                raise Superseded()
            return {**old, "status": "indexed", "index_key": key, "result": result_key,
                "chunks": len(result["chunks"]), "description": result["chunks"][0]["text"][:1800],
                "thumbnail": next((c["thumbnail"] for c in result["chunks"] if c["thumbnail"]), None), "error": None}
        self.repo.mutate("Asset", asset["id"], commit)
        return True

    def manifest(self, collection):
        return {a["id"]: [a["revision"], a.get("index_key")] for a in self.assets(collection)
                if a["status"] == "indexed"}

    def snapshot_stale(self, collection, key):
        return self.load_snapshot(key)["manifest"] != self.manifest(collection)

    def build_snapshot(self, collection):
        assets = [a for a in self.assets(collection) if a["status"] == "indexed" and a.get("index_key") == self.index_key(a)]
        chunks, manifest = [], {}
        for asset in assets:
            result = json.loads(self.objects.get(asset["result"]))
            manifest[asset["id"]] = [asset["revision"], asset["index_key"]]
            for c in result["chunks"]:
                chunks.append({**c, "revision": asset["revision"], "index_key": asset["index_key"],
                               "group": asset["group"]})
        if len(chunks) > self.settings.max_chunks:
            raise AtlasError("Collection exceeds its chunk limit. Increase ATLAS_MAX_CHUNKS or split it.")
        matrices = {"content": np.asarray([c.pop("vector") for c in chunks], dtype=np.float32),
                    "text": np.asarray([c.pop("text_vector") for c in chunks], dtype=np.float32)}
        layouts = {}
        for lens, matrix in matrices.items():
            coords, edges, method = project(matrix)
            layouts[lens] = {"coordinates": coords, "edges": edges, "method": method}
        id = uid()
        vector_key = f"snapshots/{collection}/{id}.npz"
        buffer = io.BytesIO()
        np.savez_compressed(buffer, **matrices)
        self.objects.put(vector_key, buffer.getvalue())
        snapshot = {"id": id, "collection": collection, "created": now(), "manifest": manifest,
                    "model": self.settings.embedding_model, "dimensions": self.settings.dimensions,
                    "provider": self.settings.provider, "chunks": chunks, "layouts": layouts,
                    "vector_key": vector_key}
        key = f"snapshots/{collection}/{id}.json"
        self.objects.put(key, json.dumps(snapshot).encode(), "application/json")
        self.repo.put("IndexSnapshot", id, {"id": id, "collection": collection, "key": key, "created": now(),
                                           "chunks": len(chunks), "provider": self.settings.provider})
        return key

    def load_snapshot(self, key):
        with self.cache_lock:
            if key not in self.cache:
                snapshot = json.loads(self.objects.get(key))
                with np.load(io.BytesIO(self.objects.get(snapshot["vector_key"])), allow_pickle=False) as vectors:
                    snapshot["vectors"] = {lens: vectors[lens] for lens in ("content", "text")}
                self.cache = {key: snapshot}  # Bound worker memory to one loaded snapshot.
            return self.cache[key]

    def valid_snapshot(self, collection):
        current = self.required("Collection", collection)
        assets = {a["id"]: a for a in self.assets(collection)}
        if not current.get("snapshot"):
            return None, [], assets
        snapshot = self.load_snapshot(current["snapshot"])
        valid = [i for i, c in enumerate(snapshot["chunks"]) if c["asset"] in assets
            and assets[c["asset"]]["status"] == "indexed" and
            [assets[c["asset"]]["revision"], assets[c["asset"]].get("index_key")] == [c["revision"], c["index_key"]]]
        return snapshot, valid, assets

    def map(self, collection, lens="content"):
        snapshot, valid, assets = self.valid_snapshot(collection)
        if not snapshot:
            return {"version": None, "points": [], "edges": [], "method": "empty", "provider": self.settings.provider}
        layout = snapshot["layouts"][lens]
        points = []
        for i in valid:
            c = snapshot["chunks"][i]
            x, y, z = layout["coordinates"][i]
            points.append({"id": c["id"], "asset": c["asset"], "part": c["part"], "group": c["group"],
                           "x": 500 + x * 360, "y": 360 + y * 230, "z": z * 3, "location": c["location"]})
        valid_set = set(valid)
        edges = [[snapshot["chunks"][i]["id"], snapshot["chunks"][j]["id"]]
                 for i, j in layout["edges"] if i in valid_set and j in valid_set]
        return {"version": snapshot["id"], "points": points, "edges": edges, "method": layout["method"],
                "provider": snapshot["provider"]}

    def search(self, collection, query=None, limit=12, kind=None, similar=None, image=None):
        snapshot, valid, assets = self.valid_snapshot(collection)
        if not snapshot or not valid:
            return []
        if snapshot["provider"] != self.settings.provider or snapshot["model"] != self.settings.embedding_model or snapshot["dimensions"] != self.settings.dimensions:
            raise AtlasError("Embedding configuration changed. Update the index before searching.", 409)
        if similar:
            self.required("Asset", similar)
            source = [snapshot["vectors"]["content"][i] for i in valid if snapshot["chunks"][i]["asset"] == similar]
            if not source:
                return []
            from .ai import normalized
            vector = normalized(np.mean(source, axis=0))
        else:
            vector = self.ai.embed(text=query or "", query=True, data=image, mime="image/jpeg" if image else None)
        chosen = [i for i in valid if (not kind or assets[snapshot["chunks"][i]["asset"]]["kind"] == kind)
                  and snapshot["chunks"][i]["asset"] != similar]
        if not chosen:
            return []
        matrix = snapshot["vectors"]["content"][chosen]
        scores = matrix @ vector
        order = np.argsort(-scores, kind="stable")[:limit]
        return [self.source(snapshot["chunks"][chosen[j]], assets, float(scores[j])) for j in order]

    def source(self, chunk, assets, score=0):
        asset = self.public_asset(assets[chunk["asset"]])
        return {"chunk": chunk["id"], "asset": chunk["asset"], "part": chunk["part"],
                "score": round(score, 5), "text": chunk["text"], "location": chunk["location"],
                "name": asset["name"], "preview": asset.get("image"), "url": asset["url"],
                "revision": chunk["revision"]}

    def ask(self, collection, question, history):
        self.required("Collection", collection)
        snapshot, valid, assets = self.valid_snapshot(collection)
        if not valid:
            return {"answer": "No indexed sources are available. Upload files and update the index first.",
                    "citations": [], "provider": self.settings.provider}
        plan = self.ai.plan(question, history)
        if plan["scope"] == "overview":
            sources, coverage = overview_sources([self.source(snapshot["chunks"][i], assets) for i in valid])
        else:
            candidates = {}
            for query in plan["queries"]:
                for hit in self.search(collection, query, limit=6):
                    if hit["chunk"] not in candidates or candidates[hit["chunk"]]["score"] < hit["score"]:
                        candidates[hit["chunk"]] = hit
            sources = sorted(candidates.values(), key=lambda s: -s["score"])[:8]
            coverage = {"mode": "search", "total_sources": len(valid), "included_sources": len(sources)}
        if not sources:
            return {"answer": "I found no indexed evidence for this question.", "citations": [],
                    "provider": self.settings.provider}
        images = []
        chunks = {snapshot["chunks"][j]["id"]: snapshot["chunks"][j] for j in valid}
        previews = [(i, chunks.get(source["chunk"])) for i, source in enumerate(sources)]
        previews = [(i, chunk) for i, chunk in previews if chunk and chunk.get("thumbnail")]
        for i, chunk in (spread(previews) if plan["scope"] == "overview" else previews)[:4]:
            images.append((i + 1, self.objects.get(chunk["thumbnail"]), "image/jpeg"))
        answer = self.ai.answer(question, sources, history, images, context=coverage)
        # Do not return evidence deleted/replaced while the answer was being generated.
        current = {a["id"]: a for a in self.assets(collection)}
        for source in sources:
            asset = current.get(source["asset"])
            if not asset or asset["revision"] != source["revision"] or asset["status"] != "indexed":
                raise AtlasError("A source changed while answering. Please ask again.", 409)
        answer, citations = cited_sources(answer, sources)
        return {"answer": answer, "citations": citations, "provider": self.settings.provider, "retrieval": coverage}
