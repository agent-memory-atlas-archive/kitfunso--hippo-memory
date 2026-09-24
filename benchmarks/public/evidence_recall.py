"""Free retrieval check on Mem0-runner LoCoMo output (no model calls).

For each question, the share of its gold evidence turns found in the top k
retrieved memories, from `--predict-only` output of
mem0ai/memory-benchmarks. Works for any arm whose memories hold the raw turn
text (hippo and bm25 here); Mem0's extracted memories do not, so this cannot
score mem0-oss. Usage:

    python evidence_recall.py --dataset locomo10.json --run-dir out/predicted_<name> [--k 10,50,200]
"""
from __future__ import annotations

import argparse
import glob
import json
from collections import defaultdict


def turn_texts(conv: dict) -> dict[str, str]:
    out = {}
    for key, turns in conv["conversation"].items():
        if not key.startswith("session_") or not isinstance(turns, list):
            continue
        for t in turns:
            text = t.get("text", "")
            if t.get("dia_id") and text:
                out[t["dia_id"]] = f'{t.get("speaker", "")}: {text}'
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True)
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--k", default="10,50,200")
    a = ap.parse_args()
    ks = [int(x) for x in a.k.split(",")]
    data = json.load(open(a.dataset))
    texts = {i: turn_texts(c) for i, c in enumerate(data)}
    agg = defaultdict(lambda: defaultdict(list))
    for f in sorted(glob.glob(f"{a.run_dir}/*.json")):
        q = json.load(open(f))
        ev = [e for e in q.get("evidence", []) if e in texts[q["conversation_idx"]]]
        if not ev:
            continue
        mems = [r["memory"] for r in q["retrieval"]["search_results"]]
        for k in ks:
            top = "\n".join(mems[:k])
            found = sum(texts[q["conversation_idx"]][e] in top for e in ev)
            for cat in ("all", q["category_name"]):
                agg[cat][f"recall@{k}"].append(found / len(ev))
                agg[cat][f"all@{k}"].append(float(found == len(ev)))
    for cat, m in agg.items():
        n = len(next(iter(m.values())))
        cells = "  ".join(f"{name} {100 * sum(v) / len(v):.1f}" for name, v in m.items())
        print(f"{cat:>12} n={n:<4} {cells}")


if __name__ == "__main__":
    main()
