import threading

import pytest
from fastapi.testclient import TestClient

from atlas.ai import OfflineAI
from atlas.api import create_app
from atlas.config import Settings
from atlas.errors import AtlasError
from atlas.objects import LocalObjects
from atlas.repository import MemoryRepository
from atlas.service import Service


class CountingAI(OfflineAI):
    def __init__(self):
        super().__init__(128)
        self.calls = 0

    def embed(self, **kwargs):
        self.calls += 1
        return super().embed(**kwargs)


@pytest.fixture
def service(tmp_path):
    settings = Settings(_env_file=None, provider="offline", dimensions=128, public_url="http://testserver",
                        data_dir=tmp_path)
    return Service(settings, MemoryRepository(), LocalObjects(tmp_path), CountingAI())


def upload(service, collection, text, name="notes.txt", replace=None):
    data = text.encode()
    reservation = service.reserve_upload(collection, name, len(data), replace)
    record = service.upload_record(reservation["id"])
    service.objects.put(record["key"], data)
    return service.complete_upload(record["id"])


def indexed(service):
    collection = service.create_collection("Research")["id"]
    sea = upload(service, collection, "The coast has turquoise water and weathered rocks.", "coast.txt")
    city = upload(service, collection, "The city has concrete buildings and a central library.", "city.txt")
    job, _ = service.start_job(collection)
    service.run_job(job["id"])
    assert service.required("IndexJob", job["id"])["state"] == "completed"
    return collection, sea, city


def test_index_search_ask_and_noop(service):
    collection, sea, city = indexed(service)
    assert service.ai.calls == 2
    hits = service.search(collection, "turquoise water")
    assert hits[0]["asset"] == sea["id"]
    response = service.ask(collection, "water", [])
    assert "[1]" in response["answer"]
    assert response["citations"][0]["asset"] == sea["id"]
    before = service.ai.calls
    job, _ = service.start_job(collection)
    service.run_job(job["id"])
    assert service.ai.calls == before
    assert len(service.map(collection)["points"]) == 2
    assert all("z" in p for p in service.map(collection)["points"])


def test_story_overview_reads_scenes_beyond_credit_matches(service, monkeypatch):
    collection = service.create_collection("Short film")["id"]
    upload(service, collection, "A courier loses a parcel during the journey.", "Shot 1.txt")
    upload(service, collection, "The courier finds the parcel and delivers it.", "Shot 2.txt")
    upload(service, collection, "Film credits: cast and production crew.", "Shot 10.txt")
    job, _ = service.start_job(collection)
    service.run_job(job["id"])
    monkeypatch.setattr(service.ai, "plan", lambda *_: {"scope": "overview", "queries": ["movie plot"]})
    def no_search(*args, **kwargs):
        pytest.fail("A whole-story explanation must not use only nearest search matches")
    monkeypatch.setattr(service, "search", no_search)
    def answer(question, sources, history, images, context):
        assert [s["name"] for s in sources] == ["Shot 1.txt", "Shot 2.txt", "Shot 10.txt"]
        assert context["included_sources"] == 3 and not context["limited"]
        return "A courier loses a parcel, recovers it and delivers it. [1, 2]"
    monkeypatch.setattr(service.ai, "answer", answer)
    result = service.ask(collection, "Explain the movie", [])
    assert [s["name"] for s in result["citations"]] == ["Shot 1.txt", "Shot 2.txt"]
    assert "[1][2]" in result["answer"]


def test_ask_rejects_sources_removed_during_generation(service, monkeypatch):
    collection, sea, _ = indexed(service)
    monkeypatch.setattr(service.ai, "plan", lambda *_: {"scope": "overview", "queries": []})
    def answer(*args, **kwargs):
        service.delete_asset(sea["id"])
        return "An answer from a now-deleted source. [1]"
    monkeypatch.setattr(service.ai, "answer", answer)
    with pytest.raises(AtlasError, match="source changed"):
        service.ask(collection, "Summarize everything", [])


def test_replacement_invalidates_old_index_and_identical_replace_is_noop(service):
    collection, sea, _ = indexed(service)
    old = service.required("Asset", sea["id"])
    same = upload(service, collection, "The coast has turquoise water and weathered rocks.", replace=sea["id"])
    assert same["revision"] == 1
    assert service.required("Asset", sea["id"])["source"] == old["source"]
    updated = upload(service, collection, "Volcanic mountains rise above snowy valleys.", replace=sea["id"])
    assert updated["revision"] == 2
    assert sea["id"] not in [p["asset"] for p in service.map(collection)["points"]]
    assert sea["id"] not in [h["asset"] for h in service.search(collection, "water")]
    before = service.ai.calls
    job, _ = service.start_job(collection)
    service.run_job(job["id"])
    assert service.ai.calls == before + 1
    assert service.search(collection, "volcanic snowy")[0]["asset"] == sea["id"]


def test_deletion_excluded_from_cached_snapshot_and_stale_worker_cannot_resurrect(service):
    collection, sea, _ = indexed(service)
    old = service.required("Asset", sea["id"])
    service.delete_asset(sea["id"])
    assert sea["id"] not in [h["asset"] for h in service.search(collection, "water")]
    old["status"] = "pending"
    with pytest.raises(AtlasError):
        service.index_asset(old, threading.Event())
    with pytest.raises(AtlasError):
        service.required("Asset", sea["id"])


def test_concurrent_replacements_and_job_dispatch_are_idempotent(service):
    collection, sea, _ = indexed(service)
    a = service.reserve_upload(collection, "a.txt", 1, sea["id"])
    b = service.reserve_upload(collection, "b.txt", 1, sea["id"])
    for r in (a, b):
        service.objects.put(service.upload_record(r["id"])["key"], b"x")
    service.complete_upload(a["id"])
    with pytest.raises(AtlasError):
        service.complete_upload(b["id"])
    job1, new1 = service.start_job(collection)
    job2, new2 = service.start_job(collection)
    assert new1 and not new2 and job1["id"] == job2["id"]


def test_failed_file_does_not_replace_published_snapshot(service):
    collection, sea, _ = indexed(service)
    snapshot = service.required("Collection", collection)["snapshot"]
    broken = upload(service, collection, "a" * 12001, "long.txt")
    service.settings.max_file_chunks = 1
    job, _ = service.start_job(collection)
    service.run_job(job["id"])
    assert service.required("Asset", broken["id"])["status"] == "error"
    assert service.required("Collection", collection)["snapshot"] == snapshot
    assert service.search(collection, "water")[0]["asset"] == sea["id"]


def test_api_upload_ranges_and_mcp(service):
    with TestClient(create_app(service.settings, service)) as client:
        collection = client.post("/api/v1/collections", json={"name": "Library"}).json()["id"]
        reserve = client.post(f"/api/v1/collections/{collection}/uploads", json={"name": "a.txt", "size": 11}).json()
        assert client.put(reserve["url"], content=b"hello world").status_code == 200
        result = client.post(f'/api/v1/uploads/{reserve["id"]}/complete')
        assert result.status_code == 200
        asset = result.json()
        preview = client.get(asset["url"], headers={"Range": "bytes=6-10"})
        assert preview.status_code == 206 and preview.content == b"world"
        assert client.get(asset["url"], headers={"Range": "bytes=-5"}).content == b"world"
        assert client.get(asset["url"], headers={"Range": "bytes=99-"}).status_code == 416
        assert client.head(asset["url"]).headers["content-length"] == "11"
        assert client.post("/api/v1/collections", headers={"Origin": "https://untrusted.example"},
                           json={"name": "Blocked"}).status_code == 403
        headers = {"Accept": "application/json, text/event-stream"}
        response = client.post("/mcp/", headers=headers,
                               json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}})
        assert response.status_code == 200, response.text
        assert {t["name"] for t in response.json()["result"]["tools"]} == {
            "list_collections", "get_collection", "search", "similar", "get_item"}
        call = client.post("/mcp/", headers=headers, json={"jsonrpc": "2.0", "id": 2, "method": "tools/call",
             "params": {"name": "get_item", "arguments": {"asset_id": asset["id"]}}})
        assert not call.json()["result"].get("isError"), call.text


def test_upload_validation_and_path_safety(service):
    collection = service.create_collection("Files")["id"]
    r = service.reserve_upload(collection, "fake.jpg", 4)
    service.objects.put(service.upload_record(r["id"])["key"], b"text")
    with pytest.raises(AtlasError):
        service.complete_upload(r["id"])
    assert not service.assets(collection)
    with pytest.raises(ValueError):
        service.objects.get("../outside")
    with pytest.raises(AtlasError):
        service.reserve_upload(collection, "file.html", 4)


def test_expired_worker_is_retryable(service):
    collection = service.create_collection("Jobs")["id"]
    job, _ = service.start_job(collection)
    service.repo.mutate("Collection", collection, lambda c: {**c, "lease_until": 0})
    assert service.job_status(job["id"])["state"] == "failed"
    replacement, created = service.start_job(collection)
    assert created and replacement["id"] != job["id"]


def test_lease_lost_before_publication_keeps_previous_snapshot(service):
    collection, _, _ = indexed(service)
    original = service.required("Collection", collection)["snapshot"]
    job, _ = service.start_job(collection)
    service.repo.mutate("Collection", collection, lambda c: {**c, "active_job": "newer-worker"})
    service.run_job(job["id"])
    current = service.required("Collection", collection)
    assert current["snapshot"] == original and current["active_job"] == "newer-worker"


def test_completed_worker_is_not_expired_during_status_poll(service, monkeypatch):
    collection = service.create_collection("Race")["id"]
    job, _ = service.start_job(collection)
    service.repo.mutate("Collection", collection, lambda c: {**c, "lease_until": 0})
    mutate = service.repo.mutate
    def finish_before_expire(kind, id, callback):
        if kind == "Collection":
            mutate("Collection", collection, lambda c: {**c, "active_job": None})
            mutate("IndexJob", job["id"], lambda j: {**j, "state": "completed"})
        return mutate(kind, id, callback)
    monkeypatch.setattr(service.repo, "mutate", finish_before_expire)
    assert service.job_status(job["id"])["state"] == "completed"


def test_mcp_inline_image_and_absolute_source_links(service):
    import io
    import json
    from PIL import Image
    collection = service.create_collection("Images")["id"]
    data = io.BytesIO()
    Image.new("RGB", (10, 10), "teal").save(data, format="JPEG")
    reservation = service.reserve_upload(collection, "image.jpg", len(data.getvalue()))
    record = service.upload_record(reservation["id"])
    service.objects.put(record["key"], data.getvalue())
    asset = service.complete_upload(record["id"])
    service.repo.mutate("Asset", asset["id"], lambda a: {**a, "thumbnail": record["key"]})
    with TestClient(create_app(service.settings, service)) as client:
        response = client.post("/mcp/", headers={"Accept": "application/json, text/event-stream"},
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
                "name": "get_item", "arguments": {"asset_id": asset["id"], "include_image": True}}})
        result = response.json()["result"]
        assert not result.get("isError"), result
        assert {c["type"] for c in result["content"]} == {"text", "image"}
        metadata = json.loads(result["content"][0]["text"])
        assert metadata["url"].startswith("http://testserver/api/v1/assets/")
