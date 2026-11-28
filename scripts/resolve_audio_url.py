#!/usr/bin/env python3
"""
Resolve a YouTube video's best audio-only URL via yt-dlp.

Prints a single JSON line to stdout:
  {"url": "...", "contentLength": "12345678", "mimeType": "audio/mp4; codecs=mp4a.40.2"}
Or on error:
  {"error": "..."}

Args:
  1: video id
"""
import json
import sys

import yt_dlp


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: resolve_audio_url.py <video_id>"}))
        sys.exit(1)

    video_id = sys.argv[1]
    url = f"https://www.youtube.com/watch?v={video_id}"

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
                print(json.dumps({"error": "no audio url"}))
                sys.exit(1)

            # Try to get content length from the format info
            content_length = str(info.get("filesize") or info.get("filesize_approx") or "")
            mime = info.get("ext", "m4a")
            mime_type = f"audio/{mime}"

        print(json.dumps({
            "url": audio_url,
            "contentLength": content_length,
            "mimeType": mime_type,
        }))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": str(e)[:300]}))
        sys.exit(1)


if __name__ == "__main__":
    main()
