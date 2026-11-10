"""Lay the episode embeddings out on a 2D map, for the web app's /map page.

    uv run python -m search.map [--db PATH] [--model MODEL]

Takes the episode vectors written by `search.embed` (chapters are left out)
and reduces them twice with UMAP: to 2D for drawing, and to 5D for HDBSCAN to
find clusters in, which keeps the clusters from depending on how the 2D layout
happened to squash things. Each cluster is labelled with the words most
particular to its episode and chapter titles (class-based TF-IDF).

Writes embeddings/<model name>/map.json.
"""

import argparse
import json
import re
import sqlite3
import time
from collections import Counter

import numpy as np
import umap
from sklearn.cluster import HDBSCAN

from .embed import out_dir

WORD = re.compile(r"[\w\u0600-\u06FF]{3,}")
DIACRITICS = re.compile(r"[\u064B-\u0652\u0640]")
STOPWORDS = """
الحلقة حلقة بودكاست podcast episode مع في من على إلى الى عن هل ما ماذا كيف لماذا متى أين اين هذا هذه ذلك
التي الذي الذين كان كانت يكون تكون لكن لا ليس بين بعد قبل عند كل أو او ثم حتى إذا اذا لم لن قد مقدمة
الختام الخاتمة ختام خاتمة الضيف ضيف المقدمة مقدمة الافتتاحية البداية النهاية البرومو إلى
the and for with you your from what how why are this that part intro about did really doing
"""


def normalize(text):
    text = DIACRITICS.sub("", text.lower())
    return re.sub("[أإآ]", "ا", text).replace("ة", "ه").replace("ى", "ي")


STOPWORDS = set(normalize(STOPWORDS).split())


def words(text):
    return [w for w in WORD.findall(normalize(text)) if w not in STOPWORDS and not w.isdigit()]


def label_clusters(labels, texts, top=4):
    """Top words per cluster by class-based TF-IDF: frequent in the cluster, rare across clusters."""
    clusters = sorted(set(labels) - {-1})
    counts = {c: Counter() for c in clusters}
    for label, text in zip(labels, texts):
        if label != -1:
            counts[label].update(set(words(text)))  # once per episode, so one long episode can't dominate
    df = Counter(w for c in clusters for w in counts[c])
    mean_size = np.mean([sum(counts[c].values()) for c in clusters])
    names = {}
    for c in clusters:
        total = sum(counts[c].values())
        scores = {w: n / total * np.log(1 + mean_size / df[w]) for w, n in counts[c].items() if n >= 2}
        names[c] = " · ".join(sorted(scores, key=scores.get, reverse=True)[:top])
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="podcasts.db")
    parser.add_argument("--model", default="baai/bge-m3")
    parser.add_argument("--neighbors", type=int, default=15)
    parser.add_argument("--min-cluster", type=int, default=20)
    args = parser.parse_args()

    out = out_dir(args.model)
    docs = [json.loads(line) for line in (out / "docs.jsonl").open(encoding="utf-8")]
    rows = [i for i, d in enumerate(docs) if d["kind"] == "episode"]
    vectors = np.load(out / "vectors.npy", mmap_mode="r")[rows].astype(np.float32)

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    episodes = {r[0]: r[1:] for r in conn.execute(
        """SELECT e.id, e.title, e.date, e.chapters, coalesce(c.name, e.show, '')
           FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id""")}
    keep = [n for n, i in enumerate(rows) if docs[i]["episode_id"] in episodes]  # skip deleted episodes
    vectors = vectors[keep]
    ids = [docs[rows[n]]["episode_id"] for n in keep]
    print(f"{len(ids)} episodes ({len(rows) - len(keep)} no longer in the database)")

    started = time.time()
    xy = umap.UMAP(n_neighbors=args.neighbors, min_dist=0.05, metric="cosine",
                   random_state=42).fit_transform(vectors)
    print(f"2D layout in {time.time() - started:.0f}s")
    started = time.time()
    reduced = umap.UMAP(n_neighbors=args.neighbors, n_components=5, min_dist=0.0, metric="cosine",
                        random_state=42).fit_transform(vectors)
    labels = HDBSCAN(min_cluster_size=args.min_cluster, min_samples=5).fit_predict(reduced)
    print(f"{labels.max() + 1} clusters, {np.sum(labels == -1)} episodes unclustered, "
          f"in {time.time() - started:.0f}s")

    texts = []
    for episode_id in ids:
        title, _, chapters, _ = episodes[episode_id]
        texts.append("\n".join([title or "", *(c["title"] for c in json.loads(chapters or "[]"))]))
    names = label_clusters(labels, texts)

    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))  # into [0, 1] on both axes
    channels = sorted({episodes[i][3] for i in ids})
    channel_index = {name: n for n, name in enumerate(channels)}
    points = []
    for n, episode_id in enumerate(ids):
        title, date, _, channel = episodes[episode_id]
        points.append([episode_id, round(float(xy[n, 0]), 4), round(float(xy[n, 1]), 4),
                       int(labels[n]), channel_index[channel], title or "", date or ""])
    clusters = []
    for c, name in names.items():
        members = xy[labels == c]
        center = np.median(members, axis=0)
        clusters.append({"id": int(c), "label": name, "size": len(members),
                         "x": round(float(center[0]), 4), "y": round(float(center[1]), 4)})

    meta = json.loads((out / "meta.json").read_text())
    (out / "map.json").write_text(json.dumps(
        {"model": args.model, "built_at": meta["built_at"], "channels": channels,
         "clusters": clusters, "points": points},  # point: [id, x, y, cluster, channel, title, date]
        ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {out / 'map.json'}")


if __name__ == "__main__":
    main()
