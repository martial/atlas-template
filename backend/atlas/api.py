import io
import logging
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, urlparse

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import ASGIApp

from .ai import consume
from .config import Settings
from .errors import AtlasError
from .mcp_server import make_mcp
from .media import jpeg
from .service import Service, error_message, now

log = logging.getLogger(__name__)


class CollectionInput(BaseModel):
    name: str = Field(min_length=1, max_length=120, pattern=r".*\S.*")
    description: str = Field(default="", max_length=1000)


class UploadInput(BaseModel):
    name: str = Field(min_length=1, max_length=240)
    size: int = Field(gt=0)
    replace: str | None = Field(default=None, max_length=100)


class SearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=2000, pattern=r".*\S.*")
    limit: int = Field(default=12, ge=1, le=30)
    kind: str | None = Field(default=None, pattern=r"^(image|video|audio|document)$")


class HistoryTurn(BaseModel):
    question: str = Field(max_length=4000)
    answer: str = Field(max_length=16000)


class AskInput(BaseModel):
    question: str = Field(min_length=1, max_length=4000, pattern=r"[\s\S]*\S[\s\S]*")
    history: list[HistoryTurn] = Field(default_factory=list, max_length=8)


def byte_range(header, size):
    if not header:
        return 0, size - 1, False
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
    if not match or not any(match.groups()):
        raise AtlasError("Invalid byte range.", 416)
    left, right = match.groups()
    if not left:
        count = int(right)
        if not count:
            raise AtlasError("Invalid byte range.", 416)
        start, end = max(0, size - count), size - 1
    else:
        start, end = int(left), min(int(right), size - 1) if right else size - 1
    if start > end or start >= size:
        raise AtlasError("Byte range is outside this file.", 416)
    return start, end, True


class BodyLimit:
    def __init__(self, app: ASGIApp, max_upload_bytes: int):
        self.app = app
        self.max_upload_bytes = max_upload_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        maximum = self.max_upload_bytes if scope["path"].endswith("/bytes") else 10 * 1024 * 1024
        count = 0
        async def bounded_receive():
            nonlocal count
            message = await receive()
            count += len(message.get("body", b""))
            if count > maximum:
                raise AtlasError("Request body exceeds the configured limit.", 413)
            return message
        await self.app(scope, bounded_receive, send)


def create_app(settings=None, service=None):
    settings = settings or Settings()
    service = service or Service(settings)
    mcp = make_mcp(service)
    executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="atlas-index")

    @asynccontextmanager
    async def lifespan(app):
        async with mcp.session_manager.run():
            yield
        executor.shutdown(wait=False, cancel_futures=True)

    app = FastAPI(title="Atlas", version="0.1.0", lifespan=lifespan)
    app.state.service = service
    app.add_middleware(BodyLimit, max_upload_bytes=settings.max_upload_mb * 1024 * 1024)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=[urlparse(settings.public_url).hostname,
                                                             "127.0.0.1", "localhost"])
    app.add_middleware(CORSMiddleware, allow_origins=[settings.public_url], allow_methods=["*"],
                       allow_headers=["Content-Type", "Range", "MCP-Protocol-Version", "Mcp-Session-Id"])

    @app.middleware("http")
    async def boundaries(request, call_next):
        origin = request.headers.get("origin")
        if request.method not in {"GET", "HEAD", "OPTIONS"} and origin and origin.rstrip("/") != settings.public_url.rstrip("/"):
            return JSONResponse({"detail": "Origin is not allowed."}, status_code=403)
        length = request.headers.get("content-length")
        limit = settings.max_upload_mb * 1024 * 1024 if request.url.path.endswith("/bytes") else 10 * 1024 * 1024
        if length and (not length.isdigit() or int(length) > limit):
            return JSONResponse({"detail": "Request body exceeds the configured limit."}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response

    @app.exception_handler(AtlasError)
    async def atlas_error(request, error):
        return JSONResponse({"detail": str(error)}, status_code=error.status)

    @app.exception_handler(Exception)
    async def unexpected(request, error):
        return JSONResponse({"detail": error_message(error)}, status_code=503)

    @app.get("/healthz")
    def health():
        return {"status": "ok"}

    @app.get("/api/v1/config")
    def config():
        configuration_error = None
        if settings.provider == "vertex":
            try:
                _ = service.ai.client
            except AtlasError as error:
                configuration_error = str(error)
        return {"provider": settings.provider, "configured": configuration_error is None,
                "configuration_error": configuration_error, "authentication": "adc" if settings.provider == "vertex" else "none",
                "storage": settings.storage, "database": "datastore", "jobs": settings.jobs,
                "max_upload_mb": settings.max_upload_mb, "mcp_url": settings.public_url.rstrip("/") + "/mcp/"}

    @app.get("/api/v1/collections")
    def collections():
        return service.collections()

    @app.post("/api/v1/collections", status_code=201)
    def create_collection(body: CollectionInput):
        return service.create_collection(body.name, body.description)

    @app.get("/api/v1/collections/{id}")
    def collection(id: str):
        return service.required("Collection", id)

    @app.patch("/api/v1/collections/{id}")
    def edit_collection(id: str, body: CollectionInput):
        service.required("Collection", id)
        return service.repo.mutate("Collection", id, lambda old: {**old, **body.model_dump()})

    @app.get("/api/v1/collections/{id}/assets")
    def assets(id: str):
        return [service.public_asset(a) for a in service.assets(id)]

    @app.post("/api/v1/collections/{id}/uploads")
    def reserve_upload(id: str, body: UploadInput):
        return service.reserve_upload(id, body.name, body.size, body.replace)

    @app.put("/api/v1/uploads/{id}/bytes")
    async def upload_bytes(id: str, request: Request):
        if settings.storage != "local":
            raise AtlasError("Upload bytes directly to the provided Cloud Storage session.", 409)
        record = await run_in_threadpool(service.upload_record, id)
        def claim(old):
            if old["state"] != "reserved":
                raise AtlasError("Upload is already receiving bytes or is complete.", 409)
            return {**old, "state": "receiving"}
        await run_in_threadpool(service.repo.mutate, "Upload", id, claim)
        total = 0
        try:
            with tempfile.NamedTemporaryFile() as file:
                async for chunk in request.stream():
                    total += len(chunk)
                    if total > record["size"]:
                        raise AtlasError("Upload exceeds its reserved size.", 413)
                    file.write(chunk)
                file.flush()
                if total != record["size"]:
                    raise AtlasError("Upload was incomplete.")
                await run_in_threadpool(service.objects.upload, record["key"], Path(file.name), record["mime"])
            await run_in_threadpool(service.repo.mutate, "Upload", id, lambda old: {**old, "state": "ready"})
        except Exception:
            await run_in_threadpool(service.repo.mutate, "Upload", id, lambda old: {**old, "state": "reserved"})
            raise
        return {"bytes": total}

    @app.post("/api/v1/uploads/{id}/complete")
    def complete_upload(id: str):
        return service.complete_upload(id)

    @app.get("/api/v1/assets/{id}")
    def asset(id: str):
        item = service.required("Asset", id)
        result = service.public_asset(item)
        if item["mime"] in {"text/plain", "text/markdown"}:
            result["text"] = service.objects.read_range(item["source"], 0, min(item["size"], 100000) - 1).decode("utf-8", errors="replace")
        return result

    @app.delete("/api/v1/assets/{id}", status_code=204)
    def delete_asset(id: str):
        service.delete_asset(id)
        return Response(status_code=204)

    @app.get("/api/v1/assets/{id}/thumbnail")
    def thumbnail(id: str):
        asset = service.required("Asset", id)
        if asset.get("thumbnail"):
            return Response(service.objects.get(asset["thumbnail"]), media_type="image/jpeg",
                            headers={"Cache-Control": "private, max-age=0, must-revalidate"})
        if asset["kind"] == "image":
            from PIL import Image
            with Image.open(io.BytesIO(service.objects.get(asset["source"]))) as image:
                return Response(jpeg(image, (520, 520)), media_type="image/jpeg")
        raise AtlasError("No thumbnail for this file.", 404)

    @app.api_route("/api/v1/assets/{id}/preview", methods=["GET", "HEAD"])
    def preview(id: str, request: Request):
        asset = service.required("Asset", id)
        size = asset["size"]
        try:
            start, end, partial = byte_range(request.headers.get("range"), size)
        except AtlasError:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
        headers = {"Accept-Ranges": "bytes", "Content-Length": str(end - start + 1),
            "Content-Disposition": f"inline; filename*=UTF-8''{quote(asset['name'])}",
            "Cache-Control": "private, no-cache", "Content-Security-Policy": "sandbox"}
        if partial:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        if request.method == "HEAD":
            return Response(status_code=206 if partial else 200, media_type=asset["mime"], headers=headers)
        def stream():
            for offset in range(start, end + 1, 1024 * 1024):
                yield service.objects.read_range(asset["source"], offset, min(end, offset + 1024 * 1024 - 1))
        return StreamingResponse(stream(), status_code=206 if partial else 200, media_type=asset["mime"], headers=headers)

    @app.get("/api/v1/collections/{id}/estimate")
    def estimate(id: str):
        return service.estimate(id)

    @app.post("/api/v1/collections/{id}/index")
    def index(id: str):
        if settings.provider == "vertex":
            _ = service.ai.client
        job, created = service.start_job(id)
        if created:
            try:
                if settings.jobs == "local":
                    executor.submit(service.run_job, job["id"])
                else:
                    from google.cloud import run_v2
                    run_v2.JobsClient().run_job(request={"name": settings.job_name, "overrides": {
                        "container_overrides": [{"env": [{"name": "ATLAS_JOB_ID", "value": job["id"]}]}]}})
            except Exception as error:
                service.dispatch_failed(job, error)
                raise AtlasError("Could not dispatch the index worker. Check Cloud Run job configuration.", 503) from error
        return job

    @app.get("/api/v1/jobs/{id}")
    def job(id: str):
        return service.job_status(id)

    @app.get("/api/v1/collections/{id}/map")
    def map(id: str, lens: str = Query("content", pattern="^(content|text)$")):
        return service.map(id, lens)

    def rate_limit():
        consume(service.repo, "requests-" + now()[:16], settings.requests_per_minute)

    @app.post("/api/v1/collections/{id}/search")
    def search(id: str, body: SearchInput):
        rate_limit()
        return service.search(id, body.query, body.limit, body.kind)

    @app.post("/api/v1/collections/{id}/search-image")
    async def search_image(id: str, file: UploadFile = File()):
        await run_in_threadpool(rate_limit)
        data = await file.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise AtlasError("Use a query image smaller than 8 MB.", 413)
        from PIL import Image
        try:
            with Image.open(io.BytesIO(data)) as image:
                data = jpeg(image, (2048, 2048))
        except Exception as error:
            raise AtlasError("Query file is not a supported image.") from error
        return await run_in_threadpool(service.search, id, image=data)

    @app.get("/api/v1/assets/{id}/similar")
    def similar(id: str):
        asset = service.required("Asset", id)
        return service.search(asset["collection"], similar=id, limit=8)

    @app.post("/api/v1/collections/{id}/ask")
    def ask(id: str, body: AskInput):
        rate_limit()
        return service.ask(id, body.question, [t.model_dump() for t in body.history])

    app.mount("/mcp", mcp.streamable_http_app())
    if (settings.frontend_dir / "assets").is_dir():
        app.mount("/assets", StaticFiles(directory=settings.frontend_dir / "assets"), name="assets")

    @app.get("/favicon.svg")
    def favicon():
        return FileResponse(settings.frontend_dir / "favicon.svg")

    @app.get("/")
    def frontend():
        if not (settings.frontend_dir / "index.html").is_file():
            return {"message": "Run the frontend dev server on port 5178 or build frontend/dist."}
        return FileResponse(settings.frontend_dir / "index.html")

    return app
