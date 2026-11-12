#!/usr/bin/env python3
"""
Spoor JSONL -> process map.

Reads an export (dashboard "Export JSONL" or the MCP tool export_jsonl), turns it into an
event log (case = session, activity = site + screen + action + label, timestamp = ts) and
draws a directly-follows process map.

With pm4py installed (pip install pm4py) it uses pm4py's DFG discovery and writes a PNG/SVG.
Without it, it prints the most frequent transitions and writes a Graphviz .dot file you can
render with `dot -Tsvg map.dot -o map.svg`.

Usage:
    python analysis/process_map.py export.jsonl [--out map] [--min-count 3] [--domain erp.example.com]
    python analysis/process_map.py export.jsonl --csv log.csv     # event log for other tools
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

ACTIVITY_TYPES = {"nav", "click", "submit", "change", "copy", "paste", "upload", "ai_prompt"}


def activity(e: dict) -> str:
    label = (e.get("element") or {}).get("label")
    site = (e.get("ai") or {}).get("site")
    out = f"{e.get('domain', '')}{e.get('urlTemplate', '')} · {e['type']}"
    if label:
        out += f' "{label}"'
    if site:
        out += f" [{site}]"
    return out


def load(path: str, domain: str | None) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            e = json.loads(line)
            if e.get("type") not in ACTIVITY_TYPES:
                continue
            if domain and not (e.get("domain") == domain or e.get("domain", "").endswith("." + domain)):
                continue
            rows.append(e)
    rows.sort(key=lambda e: (e["sessionId"], e["ts"]))
    # collapse consecutive identical activities inside a session
    out: list[dict] = []
    for e in rows:
        a = activity(e)
        if out and out[-1]["case"] == e["sessionId"] and out[-1]["activity"] == a:
            continue
        out.append({"case": e["sessionId"], "activity": a, "ts": e["ts"]})
    return out


def write_csv(log: list[dict], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["case:concept:name", "concept:name", "time:timestamp"])
        for r in log:
            w.writerow([r["case"], r["activity"], datetime.fromtimestamp(r["ts"] / 1000, tz=timezone.utc).isoformat()])


def dfg(log: list[dict]) -> tuple[Counter, Counter, Counter, Counter]:
    edges: Counter = Counter()
    nodes: Counter = Counter()
    starts: Counter = Counter()
    ends: Counter = Counter()
    by_case: dict[str, list[str]] = defaultdict(list)
    for r in log:
        by_case[r["case"]].append(r["activity"])
        nodes[r["activity"]] += 1
    for acts in by_case.values():
        starts[acts[0]] += 1
        ends[acts[-1]] += 1
        for a, b in zip(acts, acts[1:]):
            edges[(a, b)] += 1
    return nodes, edges, starts, ends


def write_dot(nodes: Counter, edges: Counter, min_count: int, path: str) -> None:
    keep = {n for n, c in nodes.items() if c >= min_count}
    ids = {n: f"n{i}" for i, n in enumerate(sorted(keep))}
    lines = ["digraph spoor {", '  rankdir=LR; node [shape=box, style="rounded", fontname="Helvetica", fontsize=10];']
    for n in keep:
        label = n.replace('"', '\\"')
        lines.append(f'  {ids[n]} [label="{label}\\n({nodes[n]})"];')
    for (a, b), c in edges.items():
        if c >= min_count and a in keep and b in keep:
            lines.append(f'  {ids[a]} -> {ids[b]} [label="{c}", penwidth={1 + min(c, 40) / 8:.1f}];')
    lines.append("}")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("jsonl")
    p.add_argument("--out", default="process_map", help="output file name without extension")
    p.add_argument("--min-count", type=int, default=3, help="hide activities and transitions seen fewer times")
    p.add_argument("--domain", help="only this domain (subdomains included)")
    p.add_argument("--csv", help="also write the event log as CSV (pm4py / Disco / Celonis column names)")
    p.add_argument("--top", type=int, default=25, help="transitions to print")
    args = p.parse_args()

    log = load(args.jsonl, args.domain)
    if not log:
        print("No activity events found.", file=sys.stderr)
        return 1
    if args.csv:
        write_csv(log, args.csv)
        print(f"event log: {args.csv}")

    nodes, edges, starts, ends = dfg(log)
    print(f"{len(log)} activities in {len({r['case'] for r in log})} sessions, {len(nodes)} distinct activities\n")
    print("Most frequent transitions:")
    for (a, b), c in edges.most_common(args.top):
        print(f"{c:5d}  {a}\n       -> {b}")

    try:
        import pandas as pd  # type: ignore
        import pm4py  # type: ignore
    except ImportError:
        write_dot(nodes, edges, args.min_count, args.out + ".dot")
        print(f"\npm4py not installed: wrote {args.out}.dot (render with: dot -Tsvg {args.out}.dot -o {args.out}.svg)")
        return 0

    df = pd.DataFrame(
        {
            "case:concept:name": [r["case"] for r in log],
            "concept:name": [r["activity"] for r in log],
            "time:timestamp": pd.to_datetime([r["ts"] for r in log], unit="ms", utc=True),
        }
    )
    graph, start_acts, end_acts = pm4py.discover_dfg(df)
    graph = {k: v for k, v in graph.items() if v >= args.min_count}
    for ext in ("png", "svg"):
        try:
            pm4py.save_vis_dfg(graph, start_acts, end_acts, f"{args.out}.{ext}")
            print(f"\nprocess map: {args.out}.{ext}")
            break
        except Exception as err:  # graphviz binary missing, etc.
            last = err
    else:
        write_dot(nodes, edges, args.min_count, args.out + ".dot")
        print(f"\ncould not render with pm4py ({last}); wrote {args.out}.dot")
    return 0


if __name__ == "__main__":
    sys.exit(main())
