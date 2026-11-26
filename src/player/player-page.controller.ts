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
  </script>
</body>
</html>`;
