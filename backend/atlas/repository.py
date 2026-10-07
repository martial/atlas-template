"""Datastore mode only. Payloads are unindexed; indexed collection references are small."""
import json
import time
from collections.abc import Callable
from copy import deepcopy
from threading import RLock

from google.api_core.exceptions import Aborted, Conflict
from google.cloud import datastore
from google.cloud.datastore.query import PropertyFilter

from .config import Settings


class Repository:
    def __init__(self, settings: Settings):
        self.client = datastore.Client(project=settings.project, namespace=settings.namespace,
                                       database=settings.database or None)

    def key(self, kind, id):
        return self.client.key(kind, id)

    @staticmethod
    def decode(entity):
        return json.loads(entity["payload"]) if entity else None

    def entity(self, kind, id, value):
        result = datastore.Entity(self.key(kind, id), exclude_from_indexes=["payload"])
        result.update(payload=json.dumps(value, separators=(",", ":")), collection=value.get("collection", ""))
        return result

    def get(self, kind, id):
        return self.decode(self.client.get(self.key(kind, id)))

    def put(self, kind, id, value):
        self.client.put(self.entity(kind, id, value))
        return value

    def list(self, kind, collection=None):
        query = self.client.query(kind=kind)
        if collection is not None:
            query.add_filter(filter=PropertyFilter("collection", "=", collection))
        return [self.decode(e) for e in query.fetch()]

    def mutate(self, kind, id, change: Callable):
        # Callbacks are pure: transactions may be retried after a concurrent update.
        for attempt in range(5):
            try:
                with self.client.transaction() as tx:
                    old = self.decode(self.client.get(self.key(kind, id), transaction=tx))
                    value = change(old)
                    if value is None:
                        tx.delete(self.key(kind, id))
                    else:
                        tx.put(self.entity(kind, id, value))
                return value
            except (Aborted, Conflict):
                if attempt == 4:
                    raise
                time.sleep(.03 * (2 ** attempt))


class MemoryRepository:
    """Explicit test double. Never selected by application configuration."""
    def __init__(self):
        self.data = {}
        self.lock = RLock()

    def get(self, kind, id):
        with self.lock:
            return deepcopy(self.data.get((kind, id)))

    def put(self, kind, id, value):
        with self.lock:
            self.data[kind, id] = deepcopy(value)
        return value

    def list(self, kind, collection=None):
        with self.lock:
            return deepcopy([v for (k, _), v in self.data.items() if k == kind and
                             (collection is None or v.get("collection") == collection)])

    def mutate(self, kind, id, change):
        with self.lock:
            value = change(self.get(kind, id))
            if value is None:
                self.data.pop((kind, id), None)
            else:
                self.put(kind, id, value)
            return deepcopy(value)
