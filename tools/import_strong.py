#!/usr/bin/env python3
"""Rebuild the site's embedded history from a Strong app CSV export.

    python3 tools/import_strong.py ~/Downloads/strong_workouts.csv

Copies the export to data/, regenerates data/workout_history.json, and
rewrites the HISTORY constant inside docs/index.html.
"""

import csv
import hashlib
import json
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "strong_workouts_raw.csv")
HISTORY_JSON = os.path.join(ROOT, "data", "workout_history.json")
PAGE = os.path.join(ROOT, "docs", "index.html")


def is_real_set(row):
    """Strong writes rest-timer rows into the same table; they are not sets."""
    if str(row.get("Set Order", "")).strip().lower() == "rest timer":
        return False
    reps = float(row.get("Reps") or 0)
    distance = float(row.get("Distance") or 0)
    seconds = float(row.get("Seconds") or 0)
    # A set counts if it moved reps, covered distance, or was held for time.
    return reps > 0 or distance > 0 or seconds > 0


def parse(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if is_real_set(r)]

    sessions = {}
    order = []
    for row in rows:
        key = (row["Date"], row["Workout Name"])
        if key not in sessions:
            sessions[key] = []
            order.append(key)
        sessions[key].append(row)

    out = []
    for key in order:
        date, name = key
        rws = sessions[key]
        exercises = {}
        ex_order = []
        notes = []
        for row in rws:
            ex_name = row["Exercise Name"]
            if ex_name not in exercises:
                exercises[ex_name] = []
                ex_order.append(ex_name)
            reps = float(row["Reps"] or 0)
            s = {"w": float(row["Weight"] or 0), "r": int(reps) if reps == int(reps) else reps}
            for src, dst in (("Distance", "dist"), ("Seconds", "dur")):
                val = float(row[src] or 0)
                if val:
                    s[dst] = val
            if row.get("RPE"):
                s["rpe"] = float(row["RPE"])
            exercises[ex_name].append(s)
            wn = (row.get("Workout Notes") or "").strip()
            if wn and wn not in notes:
                notes.append(wn)

        out.append({
            "id": hashlib.md5((date + name).encode()).hexdigest()[:12],
            "date": date[:10],
            "time": date[11:],
            "name": name,
            "duration": rws[0]["Duration"],
            "exercises": [{"name": n, "sets": exercises[n]} for n in ex_order],
            "note": " / ".join(notes),
            "hist": True,
        })

    out.sort(key=lambda s: (s["date"], s["time"]))
    return out


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    src = os.path.expanduser(sys.argv[1])

    sessions = parse(src)
    if not sessions:
        sys.exit("No sessions parsed — is this a Strong export?")

    shutil.copyfile(src, RAW)
    with open(HISTORY_JSON, "w", encoding="utf-8") as f:
        json.dump(sessions, f, ensure_ascii=False, separators=(",", ":"))

    blob = json.dumps(sessions, ensure_ascii=False, separators=(",", ":"))
    with open(PAGE, encoding="utf-8") as f:
        page = f.read()

    start = page.index("var HISTORY = ")
    end = page.index("];", start) + 2
    page = page[:start] + "var HISTORY = " + blob + ";" + page[end:]

    with open(PAGE, "w", encoding="utf-8") as f:
        f.write(page)

    sets = sum(len(ex["sets"]) for s in sessions for ex in s["exercises"])
    print("%d seans, %d set — %s → %s" % (
        len(sessions), sets, sessions[0]["date"], sessions[-1]["date"]))


if __name__ == "__main__":
    main()
