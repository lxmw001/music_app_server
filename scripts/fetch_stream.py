#!/usr/bin/env python3
"""
Fetch a YouTube audio stream URL and proxy the bytes to stdout.

Mirrors youtube-audio-player/backend/app/main.py: uses urllib (via yt-dlp's
plain URL fetching) so the request carries the exact headers/cookies used
during extraction — googlevideo 403s plain Node/https requests (SABR/IP-lock).

Protocol (stdout):
  Line 1: JSON object with keys: status, content_type, content_length,
          content_range  (or {"error": "..."} + exit 1)
  Then:   the raw audio bytes

Args:
  1: video id
  2: range header (e.g. "bytes=0-1000") or ""
  3: cookie header string or "" (raw Cookie header value)
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request

YTDLP = os.environ.get("YTDLP_PATH", "yt-dlp")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.18 Safari/537.36"


def die(msg):
    sys.stdout.write(json.dumps({"error": msg}) + "\n")
    sys.stdout.flush()
    sys.exit(1)


def main():
    if len(sys.argv) < 2:
        die("usage: fetch_stream.py <video_id> [range] [cookie]")

    video_id = sys.argv[1]
    range_header = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else ""
    cookie_header = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else ""

    # 1. Resolve the stream URL via yt-dlp (android client — no PO-token gating)
    cookie_file = None
    cmd = [
        YTDLP,
        "-f", "bestaudio[ext=m4a]/bestaudio/best",
        "--get-url",
        "--no-playlist",
        "--extractor-args", "youtube:player_client=android",
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if cookie_header:
        # Write cookies to a Netscape-format temp file
        lines = ["# Netscape HTTP Cookie File"]
        for part in cookie_header.split(";"):
            if "=" not in part:
                continue
            name, _, value = part.strip().partition("=")
            lines.append(
                ".youtube.com\tTRUE\t/\tTRUE\t9999999999\t%s\t%s" % (name, value)
            )
        fd, cookie_file = tempfile.mkstemp(suffix=".txt", prefix="ytc_")
        with os.fdopen(fd, "w") as f:
            f.write("\n".join(lines))
        cmd += ["--cookies", cookie_file]

    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if out.returncode != 0:
            die("yt-dlp failed: " + out.stderr.strip()[:300])
    finally:
        if cookie_file:
            try:
                os.unlink(cookie_file)
            except OSError:
                pass

    url = next((l for l in out.stdout.splitlines() if l.startswith("http")), None)
    if not url:
        die("no stream url returned")

    # 2. Fetch with urllib, forwarding Range + cookies (mirrors yt-dlp's opener)
    req = urllib.request.Request(url)
    req.add_header("User-Agent", UA)
    if range_header:
        req.add_header("Range", range_header)
    if cookie_header:
        req.add_header("Cookie", cookie_header)

    try:
        resp = urllib.request.urlopen(req, timeout=15)
    except urllib.error.HTTPError as e:
        die("upstream HTTP %d" % e.code)
    except Exception as e:  # noqa: BLE001
        die(str(e))

    # 3. Emit header line, then raw bytes
    info = {
        "status": resp.status,
        "content_type": resp.headers.get("Content-Type", "audio/mp4"),
        "content_length": resp.headers.get("Content-Length"),
        "content_range": resp.headers.get("Content-Range"),
    }
    sys.stdout.buffer.write((json.dumps(info) + "\n").encode())
    sys.stdout.buffer.flush()

    while True:
        chunk = resp.read(64 * 1024)
        if not chunk:
            break
        sys.stdout.buffer.write(chunk)
    sys.stdout.buffer.flush()


if __name__ == "__main__":
    main()
