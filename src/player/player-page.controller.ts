import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import axios from 'axios';

/**
 * Serves the YouTube IFrame player host page and proxies InnerTube requests
 * (which are blocked by CORS when made directly from the WebView).
 */
@Controller('player')
export class PlayerPageController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  getPlayerPage(): string {
    return PLAYER_HTML;
  }

  /**
   * Proxy: resolve YouTube audio URL server-side (no CORS).
   * Returns { url, contentLength, mimeType } for the best audio-only format.
   */
  @Get('resolve/:videoId')
  @Header('Cache-Control', 'no-store')
  async resolveAudio(
    @Param('videoId') videoId: string,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const resp = await axios.post(
        'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
        {
          videoId,
          context: {
            client: {
              clientName: 'ANDROID_EMBEDDED_PLAYER',
              clientVersion: '19.13.36',
              androidSdkVersion: 30,
              hl: 'en',
              gl: 'US',
            },
          },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 15_000 },
      );

      const formats: any[] =
        resp.data?.streamingData?.adaptiveFormats ?? [];
      const audioFmts = formats
        .filter((f) => f.mimeType?.includes('audio/mp4') && f.url)
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));

      if (!audioFmts.length) {
        res.status(502).json({ error: 'no audio format found' });
        return;
      }

      const fmt = audioFmts[0];
      res.json({
        url: fmt.url,
        contentLength: fmt.contentLength ?? null,
        mimeType: fmt.mimeType,
      });
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  }
}

const PLAYER_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>YouTube Player</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #000; overflow: hidden; width: 100vw; height: 100vh; }
    #player { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <div id="player"></div>
  <script src="https://www.youtube.com/iframe_api"></script>
  <script>
    'use strict';

    var player = null;
    var apiReady = false;
    var cmdQueue = [];
    var timeTimer = null;
    var currentVideoId = '';
    var currentVolume = 100;

    // === Event Bridge ===
    function postEvent(type, data) {
      var payload = JSON.stringify({ type: type, data: data || {} });
      if (window.AndroidBridge && AndroidBridge.onEvent) {
        AndroidBridge.onEvent(payload);
      } else {
        console.log('[YTPlayer] ' + payload);
      }
    }

    // === YouTube IFrame API ===
    window.onYouTubeIframeAPIReady = function() {
      apiReady = true;
      player = new YT.Player('player', {
        host: 'https://www.youtube-nocookie.com',
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: onPlayerReady,
          onStateChange: onStateChange,
          onError: onError
        }
      });
    };

    function onPlayerReady() {
      player.setVolume(currentVolume);
      postEvent('ready', { allReady: true });
      flushQueue();
    }

    function onStateChange(e) {
      var state = e.data;
      postEvent('stateChange', { state: state });
      if (state === YT.PlayerState.PLAYING) {
        startTimeTimer();
      } else if (state === YT.PlayerState.ENDED || state === YT.PlayerState.PAUSED) {
        stopTimeTimer();
      }
    }

    function onError(e) {
      var code = e.data;
      stopTimeTimer();
      var messages = {
        2: 'Invalid video parameter',
        5: 'HTML5 player error',
        100: 'Video not found',
        101: 'Embedding not allowed',
        150: 'Embedding not allowed'
      };
      postEvent('error', { code: code, message: messages[code] || ('Error ' + code) });
    }

    // === Time Timer ===
    function startTimeTimer() {
      stopTimeTimer();
      timeTimer = setInterval(function() {
        if (player && player.getCurrentTime) {
          try {
            postEvent('timeUpdate', {
              position: player.getCurrentTime(),
              duration: player.getDuration()
            });
          } catch (e) {}
        }
      }, 500);
    }

    function stopTimeTimer() {
      if (timeTimer) { clearInterval(timeTimer); timeTimer = null; }
    }

    // === Command Queue ===
    function flushQueue() {
      while (cmdQueue.length > 0) {
        var fn = cmdQueue.shift();
        fn();
      }
    }

    // === Command Dispatcher ===
    window.__cmd = function(command, arg1, arg2) {
      if (!player || !apiReady) {
        if (command !== 'getState') cmdQueue.push(function() { window.__cmd(command, arg1, arg2); });
        return;
      }
      switch (command) {
        case 'load':
          currentVideoId = arg1;
          var start = parseFloat(arg2) || 0;
          player.loadVideoById({ videoId: arg1, startSeconds: start });
          postEvent('loaded', { videoId: arg1 });
          break;
        case 'play':
          player.playVideo();
          break;
        case 'pause':
          player.pauseVideo();
          break;
        case 'seek':
          player.seekTo(parseFloat(arg1), true);
          break;
        case 'stop':
          player.stopVideo();
          stopTimeTimer();
          break;
        case 'setVolume':
          currentVolume = Math.round(parseFloat(arg1) * 100);
          player.setVolume(currentVolume);
          break;
        default:
          postEvent('error', { code: -1, message: 'Unknown command: ' + command });
      }
    };

    window.onerror = function(message) {
      postEvent('error', { code: -1, message: 'JS: ' + message });
      return false;
    };

    // === Audio Download via server proxy + fetch() ===
    // The WebView can't POST directly to YouTube's InnerTube API (CORS).
    // Our server proxies the InnerTube call and returns the audio URL,
    // then we fetch the audio bytes directly (Chromium handles IP-locked URLs).
    window.__download = function(videoId, downloadId) {
      if (!window.AndroidBridge || !AndroidBridge.onDownloadChunk) {
        console.log('[download] no AndroidBridge');
        return;
      }

      // 1. Ask our server to resolve the audio URL (server-to-server, no CORS)
      fetch('/player/resolve/' + videoId)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error || !data.url) {
            AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, error: data.error || 'no url' }));
            return;
          }
          // 2. Fetch audio bytes directly — Chromium's network stack handles
          //    IP-locked googlevideo URLs correctly
          _fetchAndSendChunks(data.url, data.contentLength || 0, downloadId);
        })
        .catch(function(e) {
          AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, error: 'resolve: ' + e }));
        });
    };

    function _fetchAndSendChunks(url, totalSize, downloadId) {
      AndroidBridge.onDownloadChunk(JSON.stringify({
        id: downloadId, total: parseInt(totalSize, 10) || 0, started: true
      }));
      fetch(url)
        .then(function(resp) {
          if (!resp.ok) {
            AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, error: 'HTTP ' + resp.status }));
            return;
          }
          var reader = resp.body.getReader();
          var received = 0;
          function pump() {
            reader.read().then(function(result) {
              if (result.done) {
                AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, done: true }));
                return;
              }
              var chunk = result.value;
              var binary = '';
              var len = chunk.length;
              for (var i = 0; i < len; i++) binary += String.fromCharCode(chunk[i]);
              received += len;
              AndroidBridge.onDownloadChunk(JSON.stringify({
                id: downloadId, chunk: btoa(binary), received: received
              }));
              pump();
            }).catch(function(e) {
              AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, error: e.toString() }));
            });
          }
          pump();
        })
        .catch(function(e) {
          AndroidBridge.onDownloadChunk(JSON.stringify({ id: downloadId, error: e.toString() }));
        });
    }
  </script>
</body>
</html>`;
