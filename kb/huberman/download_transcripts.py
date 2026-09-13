"""Download every catalogued video's transcript to disk, politely and resumably.

YouTube throttles rapid transcript requests, so this sleeps between videos, backs off
on blocks, and skips anything already saved — safe to stop and re-run at any time.
"""

import json
import random
import re
import sys
import time
from pathlib import Path

from youtube_transcript_api import (
    CouldNotRetrieveTranscript,
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    YouTubeTranscriptApi,
)

HERE = Path(__file__).parent
OUT = HERE / "transcripts"
OUT.mkdir(exist_ok=True)
STATE = HERE / "download_state.json"

DELAY = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
LANGUAGES = ["en"]

catalog = json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))
videos = catalog["videos"]

# Fitness-relevant episodes first: if the run is cut short by a block or a dropped
# connection, the half we keep is the half this project actually uses.
PRIORITY = re.compile(
    r"creatine|hypertroph|muscle|strength|resistance train|exercise|workout|training|"
    r"protein|nutrition|diet|fat loss|weight loss|metabol|supplement|testosterone|"
    r"hormone|sleep|recovery|cardio|endurance|fitness|caffeine|fasting|vitamin|omega",
    re.I,
)


def relevance(video: dict) -> int:
    text = f"{video['title']} {video['description'][:4000]}"
    return len(PRIORITY.findall(text))


videos.sort(key=relevance, reverse=True)
print(f"ordered by relevance: top='{videos[0]['title'][:60]}' ({relevance(videos[0])} hits)", flush=True)
state = json.loads(STATE.read_text()) if STATE.exists() else {"failed": {}}
api = YouTubeTranscriptApi()


def save_state():
    STATE.write_text(json.dumps(state, indent=1), encoding="utf-8")


done = skipped = failed = 0
consecutive_blocks = 0

for index, video in enumerate(videos, 1):
    path = OUT / f"{video['id']}.txt"
    if path.exists():
        skipped += 1
        continue

    try:
        fetched = api.fetch(video["id"], languages=LANGUAGES)
        lines = [
            f"# {video['title']}",
            f"# id={video['id']} published={video['published']} lang={fetched.language_code} generated={fetched.is_generated}",
            "",
        ]
        # Keep the timestamp on every line so a chapter hit can be sliced out later.
        lines += [f"[{int(s.start)//3600:d}:{int(s.start)%3600//60:02d}:{int(s.start)%60:02d}] {s.text}" for s in fetched.snippets]
        path.write_text("\n".join(lines), encoding="utf-8")
        done += 1
        consecutive_blocks = 0
        state["failed"].pop(video["id"], None)
        print(f"[{index}/{len(videos)}] ok   {video['id']}  {path.stat().st_size:>8,}B  {video['title'][:55]}", flush=True)

    except (TranscriptsDisabled, NoTranscriptFound) as exc:
        failed += 1
        state["failed"][video["id"]] = type(exc).__name__
        print(f"[{index}/{len(videos)}] none {video['id']}  {type(exc).__name__}", flush=True)

    except (RequestBlocked, IpBlocked):
        consecutive_blocks += 1
        backoff = min(600, 60 * consecutive_blocks)
        print(f"[{index}/{len(videos)}] BLOCKED — backing off {backoff}s (streak {consecutive_blocks})", flush=True)
        save_state()
        time.sleep(backoff)
        if consecutive_blocks >= 6:
            print("Too many consecutive blocks; stopping. Re-run later to resume.", flush=True)
            break
        continue

    except CouldNotRetrieveTranscript as exc:
        failed += 1
        state["failed"][video["id"]] = str(exc)[:200]
        print(f"[{index}/{len(videos)}] err  {video['id']}  {str(exc)[:80]}", flush=True)

    if index % 25 == 0:
        save_state()
    time.sleep(DELAY + random.uniform(0, 1.5))

save_state()
print(f"\nDONE  saved={done} already_had={skipped} no_transcript={failed} total_on_disk={len(list(OUT.glob('*.txt')))}")
