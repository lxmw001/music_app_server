# Error Reporting

## Endpoint

```
POST /users/me/error-report
Authorization: Bearer <firebase-token>
Content-Type: application/json
```

## Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `error` | string | ✅ | Error message |
| `stackTrace` | string | ⬜ | Full stack trace |
| `file` | string | ⬜ | File where error occurred |
| `line` | string | ⬜ | Line number |
| `screen` | string | ⬜ | Current screen/route name |
| `action` | string | ⬜ | What the user was doing (e.g. "play_song", "search", "like_song") |
| `deviceInfo` | string | ⬜ | Device model + OS version |
| `appVersion` | string | ⬜ | App version string |

## Response

```json
201 { "id": "firestore-doc-id" }
```

## Flutter Implementation

### 1. Error Reporting Service

```dart
class ErrorReportingService {
  final ApiService _api;

  ErrorReportingService(this._api);

  Future<void> report({
    required String error,
    String? stackTrace,
    String? file,
    String? line,
    String? screen,
    String? action,
  }) async {
    try {
      final deviceInfo = await _getDeviceInfo();
      final appVersion = await _getAppVersion();

      await _api.post('/users/me/error-report', body: {
        'error': error,
        if (stackTrace != null) 'stackTrace': stackTrace,
        if (file != null) 'file': file,
        if (line != null) 'line': line,
        if (screen != null) 'screen': screen,
        if (action != null) 'action': action,
        'deviceInfo': deviceInfo,
        'appVersion': appVersion,
      });
    } catch (_) {
      // Silently fail — don't crash while reporting a crash
    }
  }

  Future<String> _getDeviceInfo() async {
    final info = await DeviceInfoPlugin().deviceInfo;
    if (info is AndroidDeviceInfo) {
      return '${info.model}, Android ${info.version.release}';
    } else if (info is IosDeviceInfo) {
      return '${info.model}, iOS ${info.systemVersion}';
    }
    return 'Unknown';
  }

  Future<String> _getAppVersion() async {
    final info = await PackageInfo.fromPlatform();
    return '${info.version}+${info.buildNumber}';
  }
}
```

### 2. Global Error Handler (main.dart)

```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);

  final errorService = ErrorReportingService(ApiService());

  // Catch Flutter framework errors
  FlutterError.onError = (details) {
    errorService.report(
      error: details.exceptionAsString(),
      stackTrace: details.stack?.toString(),
      file: details.library,
    );
  };

  // Catch async errors
  PlatformDispatcher.instance.onError = (error, stack) {
    errorService.report(
      error: error.toString(),
      stackTrace: stack.toString(),
    );
    return true;
  };

  runApp(MyApp());
}
```

### 3. Try-Catch in Specific Actions

```dart
// In player service
Future<void> playSong(Song song) async {
  try {
    final url = song.streamUrl ?? await _resolveStreamUrl(song);
    await _player.play(url);
  } catch (e, stack) {
    errorReporting.report(
      error: e.toString(),
      stackTrace: stack.toString(),
      screen: 'PlayerScreen',
      action: 'play_song',
    );
    rethrow;
  }
}

// In search
Future<List<Song>> search(String query) async {
  try {
    return await api.get('/songs/search-youtube?query=$query');
  } catch (e, stack) {
    errorReporting.report(
      error: e.toString(),
      stackTrace: stack.toString(),
      screen: 'SearchScreen',
      action: 'search',
    );
    rethrow;
  }
}
```

### 4. Dependencies (pubspec.yaml)

```yaml
dependencies:
  device_info_plus: ^10.0.0
  package_info_plus: ^8.0.0
```

## Stored Document Shape (Firestore `error_reports` collection)

```json
{
  "uid": "firebase-user-id",
  "error": "VideoUnplayableException: This video is not available",
  "stackTrace": "#0 AudioService.play (audio_service.dart:45)...",
  "file": "audio_service.dart",
  "line": "45",
  "screen": "PlayerScreen",
  "action": "play_song",
  "deviceInfo": "iPhone 15, iOS 18.2",
  "appVersion": "1.2.3+42",
  "createdAt": "2026-06-19T10:00:00.000Z"
}
```
