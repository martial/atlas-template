import os
import uuid
import pytest

from atlas.config import Settings
from atlas.repository import Repository


@pytest.mark.skipif(not os.environ.get("DATASTORE_EMULATOR_HOST"), reason="Run with Datastore emulator for integration")
def test_datastore_roundtrip_and_transaction():
    # A unique namespace never deletes or resets another workspace's data.
    repo = Repository(Settings(_env_file=None, project="atlas-local", namespace="test-" + uuid.uuid4().hex))
    repo.put("Asset", "one", {"id": "one", "collection": "test", "description": "x" * 3000, "revision": 1})
    repo.mutate("Asset", "one", lambda old: {**old, "revision": old["revision"] + 1})
    assert repo.get("Asset", "one")["revision"] == 2
    assert len(repo.list("Asset", "test")) == 1
    repo.mutate("Asset", "one", lambda _: None)
    assert repo.get("Asset", "one") is None
