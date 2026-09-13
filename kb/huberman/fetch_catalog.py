"""Page through a channel's uploads and save every video's metadata + description.

Descriptions carry Huberman's timestamped chapter lists, which become the search index.
Costs ~22 quota units for 526 videos, out of 10,000/day.
"""

import json
import os
import sys
import time
from pathlib import Path

import httpx

API = "https://www.googleapis.com/youtube/v3"
HERE = Path(__file__).parent
KEY = os.environ["YOUTUBE_API_KEY"]
CHANNEL_ID = sys.argv[1] if len(sys.argv) > 1 else "UC2D2CMWXMOVWx7giW1n3LIg"


def get(endpoint: str, **params):
    for attempt in range(4):
        r = httpx.get(f"{API}/{endpoint}", params={**params, "key": KEY}, timeout=40)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 503):
            time.sleep(2 ** attempt)
            continue
        raise SystemExit(f"{endpoint} failed HTTP {r.status_code}: {r.text[:300]}")
    raise SystemExit(f"{endpoint} kept failing")


# The uploads playlist holds every public video on the channel.
channel = get("channels", id=CHANNEL_ID, part="contentDetails,snippet")
items = channel.get("items") or []
if not items:
    raise SystemExit(f"No channel found for {CHANNEL_ID}")
uploads = items[0]["contentDetails"]["relatedPlaylists"]["uploads"]
channel_title = items[0]["snippet"]["title"]
print(f"Channel: {channel_title}  uploads playlist: {uploads}", flush=True)

video_ids, page, pages = [], None, 0
while True:
    params = dict(playlistId=uploads, part="contentDetails", maxResults=50)
    if page:
        params["pageToken"] = page
    data = get("playlistItems", **params)
    video_ids += [i["contentDetails"]["videoId"] for i in data.get("items", [])]
    pages += 1
    print(f"  listed {len(video_ids)} videos ({pages} pages)", flush=True)
    page = data.get("nextPageToken")
    if not page:
        break

# Hydrate in batches of 50: snippet carries the description with its chapter list.
videos = []
for start in range(0, len(video_ids), 50):
    batch = video_ids[start : start + 50]
    data = get("videos", id=",".join(batch), part="snippet,contentDetails,statistics")
    for item in data.get("items", []):
        snippet = item["snippet"]
        videos.append(
            {
                "id": item["id"],
                "title": snippet.get("title", ""),
                "published": snippet.get("publishedAt", "")[:10],
                "duration": item.get("contentDetails", {}).get("duration", ""),
                "views": int(item.get("statistics", {}).get("viewCount", 0) or 0),
                "description": snippet.get("description", ""),
            }
        )
    print(f"  hydrated {len(videos)}/{len(video_ids)}", flush=True)

videos.sort(key=lambda v: v["published"], reverse=True)
out = HERE / "catalog.json"
out.write_text(
    json.dumps({"channel": channel_title, "channel_id": CHANNEL_ID, "videos": videos}, ensure_ascii=False, indent=1),
    encoding="utf-8",
)
total_desc = sum(len(v["description"]) for v in videos)
print(f"\nSaved {len(videos)} videos -> {out}")
print(f"Description text: {total_desc:,} chars")
