#!/usr/bin/env python3
"""Pull the full WHOOP history into data/private/whoop.json.

    python3 tools/whoop_pull.py

Reuses the OAuth token the whoop MCP server keeps in ~/.whoop-mcp/tokens.json and
the app credentials registered for that server in ~/.claude.json, refreshing the
token when it has expired. The output is health data, so it lives under
data/private/, which git ignores; only an encrypted copy is ever published.
"""

import datetime as dt
import json
import os
import subprocess
import sys
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "private", "whoop.json")
TOKENS = os.path.expanduser("~/.whoop-mcp/tokens.json")
CLAUDE_CONFIG = os.path.expanduser("~/.claude.json")
API = "https://api.prod.whoop.com/developer/v2"
TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
START = "2026-09-01T00:00:00Z"


def curl(args):
    # WHOOP sits behind Cloudflare, which turns away Python's own HTTP client (error 1010).
    out = subprocess.run(["curl", "-s", "-w", "\n%{http_code}"] + args, capture_output=True, text=True)
    body, _, code = out.stdout.rpartition("\n")
    return int(code or 0), body


def credentials():
    env = json.load(open(CLAUDE_CONFIG))["mcpServers"]["whoop"]["env"]
    return env["WHOOP_CLIENT_ID"], env["WHOOP_CLIENT_SECRET"]


def access_token():
    tokens = json.load(open(TOKENS))
    if tokens.get("expires_at", 0) - time.time() * 1000 > 120000:
        return tokens["access_token"]
    client_id, client_secret = credentials()
    code, body = curl(["-X", "POST", TOKEN_URL,
                       "--data-urlencode", "grant_type=refresh_token",
                       "--data-urlencode", "refresh_token=" + tokens["refresh_token"],
                       "--data-urlencode", "client_id=" + client_id,
                       "--data-urlencode", "client_secret=" + client_secret,
                       "--data-urlencode", "scope=offline"])
    fresh = json.loads(body) if body else {}
    if code != 200 or "access_token" not in fresh:
        sys.exit("WHOOP token refresh failed (HTTP %d) — reconnect the whoop MCP server." % code)
    # The refresh token rotates: write both back or the MCP server loses access too.
    tokens = {
        "access_token": fresh["access_token"],
        "refresh_token": fresh.get("refresh_token", tokens["refresh_token"]),
        "expires_at": int(time.time() * 1000) + fresh["expires_in"] * 1000,
        "token_type": fresh.get("token_type", "bearer"),
    }
    tmp = TOKENS + ".tmp"
    with open(tmp, "w") as f:
        json.dump(tokens, f)
    os.chmod(tmp, 0o600)
    os.replace(tmp, TOKENS)
    return tokens["access_token"]


def fetch_all(token, path):
    records, next_token = [], None
    while True:
        query = {"limit": 25, "start": START}
        if next_token:
            query["nextToken"] = next_token
        code, body = curl(["-H", "Authorization: Bearer " + token,
                           API + path + "?" + urllib.parse.urlencode(query)])
        if code != 200:
            sys.exit("WHOOP %s returned HTTP %d" % (path, code))
        page = json.loads(body)
        records.extend(page.get("records", []))
        next_token = page.get("next_token")
        if not next_token:
            return records


def local(ts, offset):
    """UTC timestamp → local wall-clock ISO string, using the offset WHOOP recorded."""
    if not ts:
        return None
    sign = 1 if offset[0] == "+" else -1
    hours, minutes = int(offset[1:3]), int(offset[4:6])
    t = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    t += sign * dt.timedelta(hours=hours, minutes=minutes)
    return t.strftime("%Y-%m-%dT%H:%M")


def hours(ms):
    return round((ms or 0) / 3.6e6, 2)


def minutes(ms):
    return round((ms or 0) / 6e4)


def main():
    token = access_token()
    raw = {name: fetch_all(token, path) for name, path in (
        ("cycles", "/cycle"), ("recovery", "/recovery"),
        ("sleep", "/activity/sleep"), ("workouts", "/activity/workout"))}

    cycles = {}
    for c in raw["cycles"]:
        if c.get("score_state") != "SCORED" or not c.get("score"):
            continue
        off = c.get("timezone_offset") or "+00:00"
        cycles[c["id"]] = {"start": local(c["start"], off), "end": local(c.get("end"), off),
                           "strain": round(c["score"]["strain"], 1),
                           "kcal": round(c["score"]["kilojoule"] / 4.184)}

    sleeps = []
    for s in raw["sleep"]:
        if s.get("score_state") != "SCORED":
            continue
        off = s.get("timezone_offset") or "+00:00"
        sc, st = s["score"], s["score"]["stage_summary"]
        sleeps.append({
            "id": s["id"], "nap": s["nap"],
            "start": local(s["start"], off), "end": local(s["end"], off),
            "bed": hours(st["total_in_bed_time_milli"]),
            "asleep": hours(st["total_in_bed_time_milli"] - st["total_awake_time_milli"]),
            "awake": hours(st["total_awake_time_milli"]),
            "light": hours(st["total_light_sleep_time_milli"]),
            "sws": hours(st["total_slow_wave_sleep_time_milli"]),
            "rem": hours(st["total_rem_sleep_time_milli"]),
            "dist": st.get("disturbance_count"),
            "perf": sc.get("sleep_performance_percentage"),
            "eff": round(sc.get("sleep_efficiency_percentage") or 0, 1),
            "cons": sc.get("sleep_consistency_percentage"),
            "rr": round(sc.get("respiratory_rate") or 0, 1),
            "debt": hours(sc["sleep_needed"]["need_from_sleep_debt_milli"]),
        })

    # A recovery belongs to the morning its sleep ended; date it by that wake-up.
    sleep_end = {s["id"]: s["end"] for s in sleeps}
    recovery = []
    for r in raw["recovery"]:
        if r.get("score_state") != "SCORED":
            continue
        sc = r["score"]
        woke = sleep_end.get(r.get("sleep_id")) or local(r["created_at"], "+03:00")
        recovery.append({
            "date": woke[:10], "score": sc["recovery_score"],
            "hrv": round(sc["hrv_rmssd_milli"], 1), "rhr": sc["resting_heart_rate"],
            "spo2": round(sc.get("spo2_percentage") or 0, 1),
            "skin": round(sc.get("skin_temp_celsius") or 0, 2),
            "calibrating": sc.get("user_calibrating", False),
        })

    workouts = []
    for w in raw["workouts"]:
        if w.get("score_state") != "SCORED" or not w.get("score"):
            continue
        off = w.get("timezone_offset") or "+00:00"
        sc = w["score"]
        zones = sc.get("zone_durations") or {}
        workouts.append({
            "start": local(w["start"], off), "end": local(w["end"], off),
            "sport": w.get("sport_name"), "strain": round(sc.get("strain") or 0, 1),
            "avg": sc.get("average_heart_rate"), "max": sc.get("max_heart_rate"),
            "kcal": round((sc.get("kilojoule") or 0) / 4.184),
            "zones": [minutes(zones.get("zone_%s_milli" % z)) for z in
                      ("zero", "one", "two", "three", "four", "five")],
        })

    by_start = lambda x: x.get("start") or x.get("date")
    data = {
        "pulled": dt.datetime.now().strftime("%Y-%m-%dT%H:%M"),
        "recovery": sorted(recovery, key=by_start),
        "sleep": sorted(sleeps, key=by_start),
        "workouts": sorted(workouts, key=by_start),
        "cycles": sorted(cycles.values(), key=by_start),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
    print("WHOOP: %d recovery, %d sleep, %d workouts, %d cycles → %s" % (
        len(recovery), len(sleeps), len(workouts), len(cycles), os.path.relpath(OUT, ROOT)))


if __name__ == "__main__":
    main()
