"""Find where a topic is discussed, and print only those passages.

Searches the chapter index, then slices each matching transcript from the chapter's
timestamp to the next chapter — so a query costs a few thousand tokens, not a whole
2-hour episode.

  python lookup.py creatine
  python lookup.py "creatine" "loading phase" --max 5 --window 8
"""

import argparse
import re
from pathlib import Path

HERE = Path(__file__).parent
INDEX = HERE / "chapters.tsv"
TRANSCRIPTS = HERE / "transcripts"

STAMP = re.compile(r"^\[(\d+):(\d\d):(\d\d)\]\s*(.*)$")


def to_seconds(stamp: str) -> int:
    parts = [int(p) for p in stamp.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def load_index():
    rows = []
    for line in INDEX.read_text(encoding="utf-8").splitlines():
        if line.startswith("#") or not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) == 5:
            rows.append(dict(zip(("id", "published", "stamp", "chapter", "title"), parts)))
    return rows


def segment(video_id: str, start_s: int, end_s: int) -> str:
    path = TRANSCRIPTS / f"{video_id}.txt"
    if not path.exists():
        return "(transcript not downloaded yet)"
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        match = STAMP.match(line)
        if not match:
            continue
        h, m, s, text = match.groups()
        t = int(h) * 3600 + int(m) * 60 + int(s)
        if start_s <= t < end_s:
            out.append(text.strip())
    return " ".join(out) if out else "(no transcript lines in this range)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("terms", nargs="+", help="terms to look for in chapter titles (OR)")
    ap.add_argument("--max", type=int, default=4, help="how many chapters to expand")
    ap.add_argument("--window", type=int, default=10, help="max minutes to read per chapter")
    ap.add_argument("--list-only", action="store_true", help="show matching chapters, no transcript text")
    args = ap.parse_args()

    rows = load_index()
    patterns = [re.compile(re.escape(t), re.I) for t in args.terms]
    hits = [r for r in rows if any(p.search(r["chapter"]) for p in patterns)]

    if not hits:
        print(f"No chapter matches for {args.terms}")
        return

    # Chapters within one video, ordered, so each hit's end is the next chapter's start.
    by_video = {}
    for row in rows:
        by_video.setdefault(row["id"], []).append(to_seconds(row["stamp"]))
    for stamps in by_video.values():
        stamps.sort()

    print(f"{len(hits)} chapter match(es) for {args.terms}\n")

    for row in hits if args.list_only else hits[: args.max]:
        start = to_seconds(row["stamp"])
        later = [s for s in by_video[row["id"]] if s > start]
        end = min(later[0] if later else start + args.window * 60, start + args.window * 60)

        print(f"{'=' * 78}")
        print(f"{row['title'][:74]}")
        print(f"  {row['published']} | {row['stamp']} | {row['chapter']}")
        print(f"  https://www.youtube.com/watch?v={row['id']}&t={start}s")
        if not args.list_only:
            print(f"{'-' * 78}")
            print(segment(row["id"], start, end))
        print()

    if not args.list_only and len(hits) > args.max:
        print(f"... {len(hits) - args.max} more chapters matched. Use --list-only to see them all.")


if __name__ == "__main__":
    main()
