"""Turn each video's description into a flat, greppable chapter index.

Huberman's descriptions list chapters as "HH:MM:SS Title". Those lines say what is
discussed where, so grepping them locates a topic down to the minute.
"""

import json
import re
from pathlib import Path

HERE = Path(__file__).parent
catalog = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))

CHAPTER = re.compile(r"^\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s+(.{2,120}?)\s*$")
SKIP = re.compile(r"^(sponsor|sponsors)\b[:\s]", re.I)

lines, with_chapters, total_chapters = [], 0, 0

for video in catalog["videos"]:
    chapters = []
    for raw in video["description"].splitlines():
        match = CHAPTER.match(raw)
        if not match:
            continue
        stamp, label = match.group(1), match.group(2).strip()
        if SKIP.match(label) or len(label) < 3:
            continue
        chapters.append((stamp, label))

    if not chapters:
        continue
    with_chapters += 1
    total_chapters += len(chapters)

    for stamp, label in chapters:
        # One self-contained line per chapter: grep hits give topic, video and timestamp.
        lines.append(f"{video['id']}\t{video['published']}\t{stamp}\t{label}\t{video['title']}")

index = HERE / "chapters.tsv"
header = "# video_id\tpublished\ttimestamp\tchapter\tvideo_title\n"
index.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")

print(f"videos in catalog : {len(catalog['videos'])}")
print(f"videos w/ chapters: {with_chapters}")
print(f"chapter lines     : {total_chapters:,}")
print(f"index size        : {index.stat().st_size:,} bytes -> {index}")
