import threading
import time
from datetime import datetime, timezone

class SnapshotCache:
    def __init__(self, ttl: float = 5, max_entries: int = 256):
        self.ttl = ttl
        self.max_entries = max_entries
        self._lock = threading.Lock()
        self._entries = {}
        self._key_locks = {}

    def get(self, key, loader, ttl: float | None = None):
        """Return (value, stale). `ttl` overrides the default lifetime for this entry (finished shifts never change)."""
        ttl = self.ttl if ttl is None else ttl
        with self._lock:
            key_lock = self._key_locks.setdefault(key, threading.Lock())
        # Separate keys can load in parallel while repeated requests for the
        # same machine and shift still share one snapshot.
        with key_lock:
            with self._lock:
                entry = self._entries.get(key)
            if entry and time.monotonic() - entry[0] < ttl:
                return entry[1], False
            try:
                value = loader()
                with self._lock:
                    self._entries[key] = (time.monotonic(), value, datetime.now(timezone.utc).isoformat())
                    self._evict()
                return value, False
            except Exception:
                if entry:
                    return entry[1], True
                raise

    def _evict(self):
        # Long-lived entries for finished shifts would otherwise grow without bound.
        while len(self._entries) > self.max_entries:
            oldest = min(self._entries, key=lambda k: self._entries[k][0])
            del self._entries[oldest]
            self._key_locks.pop(oldest, None)
