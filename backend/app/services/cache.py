import threading
import time
from datetime import datetime, timezone

class SnapshotCache:
    def __init__(self, ttl: float = 5):
        self.ttl = ttl
        self._lock = threading.Lock()
        self._entries = {}
        self._key_locks = {}

    def get(self, key, loader):
        with self._lock:
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        # Separate keys can load in parallel while repeated requests for the
        # same machine and shift still share one snapshot.
        with key_lock:
            with self._lock:
                entry = self._entries.get(key)
            if entry and time.monotonic() - entry[0] < self.ttl:
                return entry[1], False
            try:
                value = loader()
                with self._lock:
                    self._entries[key] = (time.monotonic(), value, datetime.now(timezone.utc).isoformat())
                return value, False
            except Exception:
                if entry:
                    return entry[1], True
                raise
