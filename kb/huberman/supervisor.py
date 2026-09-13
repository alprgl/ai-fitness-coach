"""Keep retrying the transcript download until the catalogue is exhausted.

YouTube's IP blocks last hours, so a single pass cannot finish. This runs a pass,
waits out the cooldown, and runs again — skipping whatever is already on disk —
until every video is either downloaded or known to have no transcript.
"""

import json
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
PY = str(Path.home() / ".claude/mcp-servers/youtube/.venv/bin/python")
TRANSCRIPTS = HERE / "transcripts"
STATE = HERE / "download_state.json"

TOTAL = len(json.loads((HERE / "catalog.json").read_text(encoding="utf-8"))["videos"])
PASS_DELAY = 4.0          # short: the cap is ~20 requests per IP, not a rate
COOLDOWN = 60 * 60        # wait out the block before the next pass
MAX_PASSES = 500          # multi-day grind; each pass adds whatever the cap allows


def stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def counts() -> tuple[int, int]:
    on_disk = len(list(TRANSCRIPTS.glob("*.txt")))
    failed = len(json.loads(STATE.read_text())["failed"]) if STATE.exists() else 0
    return on_disk, failed


for attempt in range(1, MAX_PASSES + 1):
    before, failed = counts()
    if before + failed >= TOTAL:
        print(f"[{stamp()}] COMPLETE — {before} transcripts, {failed} without captions", flush=True)
        break

    print(f"[{stamp()}] pass {attempt}: {before}/{TOTAL} on disk, {failed} captionless", flush=True)
    subprocess.run([PY, str(HERE / "download_transcripts.py"), str(PASS_DELAY)], cwd=HERE)

    after, failed = counts()
    gained = after - before
    print(f"[{stamp()}] pass {attempt} ended: +{gained} (now {after}/{TOTAL})", flush=True)

    if after + failed >= TOTAL:
        print(f"[{stamp()}] COMPLETE — {after} transcripts, {failed} without captions", flush=True)
        break

    # No progress means we are still blocked; wait out the cooldown before trying again.
    wait = COOLDOWN if gained == 0 else 120
    print(f"[{stamp()}] sleeping {wait//60} min before next pass", flush=True)
    time.sleep(wait)
else:
    print(f"[{stamp()}] stopped after {MAX_PASSES} passes", flush=True)
