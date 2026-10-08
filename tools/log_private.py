#!/usr/bin/env python3
"""Record a morning weigh-in or a cardio session in data/private/body.json.

    python3 tools/log_private.py weight 81.6 [--date 2026-09-28]
    python3 tools/log_private.py cardio 25 132 118 [--date ...] [--note "BikeErg Z2"]
                                        minutes watts avg-HR
    python3 tools/log_private.py checkin --sleep 6.5 --soreness 0 --back 2.5 [--energy 7]
                                         [--weight 81.6] [--cigs 8] [--date ...]

One entry per day for weight (a second one replaces the first); cardio entries
accumulate. Like the WHOOP pull, this file stays out of git.
"""

import argparse
import datetime as dt
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BODY = os.path.join(ROOT, "data", "private", "body.json")


def load():
    if os.path.exists(BODY):
        with open(BODY, encoding="utf-8") as f:
            return json.load(f)
    return {"weight": [], "cardio": [], "checkin": []}


def save(data):
    os.makedirs(os.path.dirname(BODY), exist_ok=True)
    with open(BODY, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="kind", required=True)
    w = sub.add_parser("weight")
    w.add_argument("kg", type=float)
    c = sub.add_parser("cardio")
    c.add_argument("minutes", type=float)
    c.add_argument("watts", type=float)
    c.add_argument("hr", type=float)
    c.add_argument("--note", default="")
    k = sub.add_parser("checkin")
    for f in ("sleep", "soreness", "back", "energy", "weight", "cigs"):
        k.add_argument("--" + f, type=float)
    for s in (w, c, k):
        s.add_argument("--date", default=dt.date.today().isoformat())
    a = p.parse_args()

    data = load()
    data.setdefault("checkin", [])
    if a.kind == "checkin":
        entry = {"date": a.date}
        for f in ("sleep", "soreness", "back", "energy", "cigs"):
            if getattr(a, f) is not None:
                entry[f] = getattr(a, f)
        data["checkin"] = [x for x in data["checkin"] if x["date"] != a.date] + [entry]
        data["checkin"].sort(key=lambda x: x["date"])
        if a.weight is not None:
            data["weight"] = [x for x in data["weight"] if x["date"] != a.date] + [{"date": a.date, "kg": a.weight}]
            data["weight"].sort(key=lambda x: x["date"])
        print("check-in " + a.date + ": " + ", ".join("%s %g" % (k, v) for k, v in entry.items() if k != "date"))
    elif a.kind == "weight":
        data["weight"] = [x for x in data["weight"] if x["date"] != a.date]
        data["weight"].append({"date": a.date, "kg": a.kg})
        data["weight"].sort(key=lambda x: x["date"])
        print("kilo %s: %.1f kg" % (a.date, a.kg))
    else:
        data["cardio"].append({"date": a.date, "min": a.minutes, "watts": a.watts,
                               "hr": a.hr, "note": a.note})
        data["cardio"].sort(key=lambda x: x["date"])
        print("kardiyo %s: %g dk, %g W, nabız %g" % (a.date, a.minutes, a.watts, a.hr))
    save(data)


if __name__ == "__main__":
    main()
