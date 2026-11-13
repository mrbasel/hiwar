"""Embeddings through OpenRouter.

The key comes from OPENROUTER_KEY, in the environment or in `.env`.
"""

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np

API = "https://openrouter.ai/api/v1/embeddings"
ENV_FILE = Path(__file__).parent.parent / ".env"


def api_key():
    if os.environ.get("OPENROUTER_KEY"):
        return os.environ["OPENROUTER_KEY"]
    for line in ENV_FILE.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.strip() == "OPENROUTER_KEY":
            return value.strip().strip("\"'")
    raise RuntimeError("OPENROUTER_KEY not set")


def embed(model, texts, key, tries=10):
    """Unit-length float32 vectors for `texts`, in order."""
    req = urllib.request.Request(
        API, data=json.dumps({"model": model, "input": texts}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "User-Agent": "rawi-search/0.1"},  # the default Python agent is blocked
    )
    for attempt in range(tries):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=120))
            break
        except urllib.error.HTTPError as err:
            if err.code not in (408, 429, 500, 502, 503, 504) or attempt == tries - 1:
                raise RuntimeError(f"{err.code}: {err.read()[:300]!r}") from err
        except (urllib.error.URLError, TimeoutError):
            if attempt == tries - 1:
                raise
        time.sleep(min(2 ** attempt, 60))  # up to ~5 min in total, for overloaded providers
    if "data" not in r:  # errors from the upstream provider can come back as 200
        raise RuntimeError(f"no embeddings in reply: {json.dumps(r)[:300]}")
    rows = sorted(r["data"], key=lambda d: d["index"])
    vectors = np.array([d["embedding"] for d in rows], dtype=np.float32)
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)
