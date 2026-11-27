import { Controller, Get, Header } from '@nestjs/common';

/**
 * Serves the YouTube IFrame player host page.
 *
 * Why this exists: YouTube embeds inside an Android WebView loaded via
 * loadDataWithBaseURL() fail with error 152 because the page has no real
 * remote origin, so no valid Referer is sent with iframe requests. Hosting
 * the player page on a real HTTPS origin fixes that.
 */
@Controller('player')
export class PlayerPageController {
  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  getPlayerPage(): string {
    return PLAYER_HTML;
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

    // === Audio Download via InnerTube + fetch() ===
    // Uses Chromium's authenticated network stack to resolve and download the
    // audio stream. youtube_explode_dart on Android gets 403 on rqh=1 URLs
    // from the device IP; Chromium handles them correctly.
    window.__download = function(videoId, downloadId) {
      if (!window.AndroidBridge || !AndroidBridge.onDownloadChunk) {
        console.log('[download] no bridge');
        return;
      }

      // 1. Resolve audio URL via YouTube InnerTube player endpoint
      //    The android_embedded client returns non-rqh=1 audio-only URLs.
      fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: videoId,
          context: {
            client: {
              clientName: 'ANDROID_EMBEDDED_PLAYER',
              clientVersion: '19.13.36',
              androidSdkVersion: 30,
              hl: 'en', gl: 'US'
            }
          }
        })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var formats = (data.streamingData && data.streamingData.adaptiveFormats) || [];
        // Pick best audio-only m4a format
        var audioFmts = formats.filter(function(f) {
          return f.mimeType && f.mimeType.indexOf('audio/mp4') !== -1 && f.url;
        });
        audioFmts.sort(function(a, b) { return (b.bitrate||0) - (a.bitrate||0); });
        var fmt = audioFmts[0];
        if (!fmt || !fmt.url) {
          AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: 'no audio format found'}));
          return;
        }
        _fetchAndSendChunks(fmt.url, fmt.contentLength || 0, downloadId);
      })
      .catch(function(e) {
        AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: 'innertube: ' + e}));
      });
    };

    function _fetchAndSendChunks(url, totalSize, downloadId) {
      AndroidBridge.onDownloadChunk(JSON.stringify({
        id: downloadId, total: parseInt(totalSize, 10) || 0, started: true
      }));
      fetch(url)
        .then(function(resp) {
          if (!resp.ok) {
            AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: 'HTTP ' + resp.status}));
            return;
          }
          var reader = resp.body.getReader();
          var received = 0;
          function pump() {
            reader.read().then(function(result) {
              if (result.done) {
                AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, done: true}));
                return;
              }
              var chunk = result.value; // Uint8Array
              // Encode to base64 to pass through the JS→Java string bridge
              var binary = '';
              var len = chunk.length;
              for (var i = 0; i < len; i++) binary += String.fromCharCode(chunk[i]);
              received += len;
              AndroidBridge.onDownloadChunk(JSON.stringify({
                id: downloadId, chunk: btoa(binary), received: received
              }));
              pump();
            }).catch(function(e) {
              AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: e.toString()}));
            });
          }
          pump();
        })
        .catch(function(e) {
          AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: e.toString()}));
        });
    }

    // === Audio Download via fetch() ===
    // Uses Chromium's network stack (which handles IP-locked URLs) to download
    // audio and stream chunks back to Android via the JS bridge.
    window.__download = function(videoId, downloadId) {
      if (!window.AndroidBridge || !AndroidBridge.onDownloadChunk) return;
      // Get the audio URL from the currently loaded player if videoId matches,
      // otherwise use ytdl-style innertube to resolve it.
      var audioUrl = null;
      try {
        if (player && player.getVideoUrl) {
          // player.getVideoUrl() returns the watch URL not the stream — we need
          // to use the MediaSource API to intercept the actual audio URL.
          // Instead, use fetch() against YouTube's InnerTube player endpoint.
        }
      } catch(e) {}

      // Use YouTube's InnerTube API to get a playable audio URL server-side
      // is not possible here without a PO token. Instead, load the video into
      // a hidden <video> element and use MediaSource to capture the stream URL.
      // Simplest approach: use the existing player's internal URL via
      // getInternalPlayer().getPlayerState() — not exposed.
      //
      // Fallback: use fetch() on a known audio-only endpoint format.
      // The most reliable: load videoId in player, get URL from media element.
      var videoEl = document.querySelector('video');
      if (videoEl && videoEl.src && videoEl.src.indexOf('googlevideo') !== -1) {
        _fetchAndSendChunks(videoEl.src, downloadId);
      } else {
        // Load the video first, then capture
        window.__cmd('load', videoId, 0);
        var attempts = 0;
        var interval = setInterval(function() {
          var el = document.querySelector('video');
          if (el && el.src && el.src.indexOf('googlevideo') !== -1) {
            clearInterval(interval);
            _fetchAndSendChunks(el.src, downloadId);
          } else if (++attempts > 20) {
            clearInterval(interval);
            AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: 'no video src found'}));
          }
        }, 500);
      }
    };

    function _fetchAndSendChunks(url, downloadId) {
      fetch(url)
        .then(function(resp) {
          if (!resp.ok) {
            AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: 'HTTP ' + resp.status}));
            return;
          }
          var total = parseInt(resp.headers.get('content-length') || '0', 10);
          AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, total: total, started: true}));
          var reader = resp.body.getReader();
          var received = 0;
          function pump() {
            reader.read().then(function(result) {
              if (result.done) {
                AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, done: true}));
                return;
              }
              var chunk = result.value; // Uint8Array
              // Convert to base64 to pass through the JS bridge
              var binary = '';
              for (var i = 0; i < chunk.length; i++) {
                binary += String.fromCharCode(chunk[i]);
              }
              var b64 = btoa(binary);
              received += chunk.length;
              AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, chunk: b64, received: received}));
              pump();
            }).catch(function(e) {
              AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: e.toString()}));
            });
          }
          pump();
        })
        .catch(function(e) {
          AndroidBridge.onDownloadChunk(JSON.stringify({id: downloadId, error: e.toString()}));
        });
    }
  </script>
</body>
</html>`;
