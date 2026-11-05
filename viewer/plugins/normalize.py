"""Datasette plugin: SQL function `normalize(text)`, the same one the index was built with."""

import sys
from pathlib import Path

from datasette import hookimpl

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pipeline.normalize import normalize  # noqa: E402


@hookimpl
def prepare_connection(conn):
    conn.create_function("normalize", 1, normalize, deterministic=True)
