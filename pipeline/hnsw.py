"""HNSW index over a model's embeddings, for fast approximate search.

The index (embeddings/<model>/hnsw.usearch, see `embed.index_path`) holds
every row of the model's embeddings table, keyed by its id. Rows are only
ever added or dropped, never changed, so the index is current when it holds
exactly the table's ids. It's rebuilt in full whenever it isn't; the API
memory-maps the file and checks the same thing before using it.
"""

import os

import numpy as np
from usearch.index import Index

CONNECTIVITY = 16  # graph edges per node (HNSW's M)
EXPANSION_ADD = 128  # candidates considered while linking a new node


def table_ids(conn, table):
    return np.array([r[0] for r in conn.execute(f"SELECT id FROM {table} ORDER BY id")], dtype=np.uint64)


def load(path):
    """The saved index, memory-mapped; None if there's none."""
    return Index.restore(str(path), view=True) if path.exists() else None


def is_current(index, ids):
    return index is not None and len(index) == len(ids) and bool(np.all(index.contains(ids)))


def build(conn, table, path):
    """Rebuilds the index at `path` from the table, unless it's current."""
    ids = table_ids(conn, table)
    if is_current(load(path), ids):
        return
    rows = conn.execute(f"SELECT id, vector FROM {table} ORDER BY id").fetchall()
    keys = np.array([r[0] for r in rows], dtype=np.uint64)
    vectors = np.frombuffer(b"".join(r[1] for r in rows), dtype="<f2").reshape(len(rows), -1)
    index = Index(ndim=vectors.shape[1], metric="ip", dtype="f16",
                  connectivity=CONNECTIVITY, expansion_add=EXPANSION_ADD)
    index.add(keys, vectors)
    # Renamed into place, so a running API keeps the file it mapped.
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    index.save(str(tmp))
    os.replace(tmp, path)
    print(f"{path}: HNSW over {len(index)} documents")
