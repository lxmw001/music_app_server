#!/usr/bin/env python3
"""
Fetch a YouTube audio stream and proxy the bytes to stdout.

Uses yt-dlp as a Python library (not subprocess) so the urllib opener
carries the exact headers/cookies used during extraction — the same
approach as youtube-audio-player/backend/app/main.py which is known to
work. Subprocess + --get-url stopped working when YouTube added bot
verification for the android client.

Protocol (stdout):
  Line 1: JSON object: {status, content_type, content_length, content_range}
           or {"error": "..."} + exit 1
  Then:   raw audio bytes

Args:
  1: video id
  2: range header (e.g. "bytes=0-1000") or ""
"""
import json
import sys

import yt_dlp


def die(msg: str) -> None:
    sys.stdout.buffer.write((json.dumps({"error": msg}) + "\n").encode())
    sys.stdout.buffer.flush()
    sys.exit(1)


def main() -> None:
    if len(sys.argv) < 2:
        die("usage: fetch_stream.py <video_id> [range]")

    video_id = sys.argv[1]
    range_header = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ""

    url = f"https://www.youtube.com/watch?v={video_id}"

    # 1. Resolve stream URL via yt-dlp library (android client bypasses
    #    PO-token gating; library mode carries the right cookies/headers)
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "extractor_args": {"youtube": {"player_client": ["android"]}},
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            audio_url = info.get("url")
            if not audio_url:
                die("no audio url in yt-dlp response")
    except Exception as e:  # noqa: BLE001
        die(f"yt-dlp failed: {e}")

    # 2. Fetch audio bytes using yt-dlp's own urllib opener so the request
    #    carries the same headers/cookies as the extraction — plain urllib
    #    requests get 403 from googlevideo (SABR / IP-lock).
    req = yt_dlp.utils.sanitized_Request(audio_url)
    if range_header:
        req.add_header("Range", range_header)

    try:
        with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
            resp = ydl.urlopen(req)
    except Exception as e:  # noqa: BLE001
        die(f"fetch failed: {e}")

    # 3. Emit JSON header line, then raw bytes
    info_line = {
        "status": getattr(resp, "status", 200),
        "content_type": resp.headers.get("Content-Type", "audio/mp4"),
        "content_length": resp.headers.get("Content-Length"),
        "content_range": resp.headers.get("Content-Range"),
    }
    sys.stdout.buffer.write((json.dumps(info_line) + "\n").encode())
    sys.stdout.buffer.flush()

    while True:
        chunk = resp.read(64 * 1024)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
