# Flutter Integration Guide

## Base URL

```
Production: https://music-app-server-<hash>-uc.a.run.app
Local:      http://localhost:3000
```

---

## 1. Firebase Setup

### pubspec.yaml dependencies
```yaml
dependencies:
  firebase_core: ^3.x.x
  firebase_auth: ^5.x.x
  google_sign_in: ^6.x.x   # if using Google login
  http: ^1.x.x              # or dio
```

### main.dart
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  runApp(MyApp());
}
```

---

## 2. Authentication

### Get ID token (call before every API request)
```dart
Future<String?> getToken() async {
  final user = FirebaseAuth.instance.currentUser;
  if (user == null) return null;
  return await user.getIdToken(); // auto-refreshes if expired
}
```

### Force token refresh (after permission changes)
```dart
final token = await user.getIdToken(true); // forceRefresh: true
```

### API request helper
```dart
Future<http.Response> apiGet(String path, {bool requiresAuth = true}) async {
  final headers = <String, String>{'Content-Type': 'application/json'};
  if (requiresAuth) {
    final token = await getToken();
    if (token != null) headers['Authorization'] = 'Bearer $token';
  }
  return http.get(Uri.parse('$baseUrl$path'), headers: headers);
}
```

---

## 3. Endpoints

### Songs

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/songs` | Optional | List songs (paginated) |
| GET | `/songs/:id` | Optional | Get song by ID |
| GET | `/songs/trending?country=EC` | Optional | Trending songs (last 7 days) |
| GET | `/songs/trending?country=EC&force=true` | Optional | Force fresh trending |
| GET | `/songs/search-youtube?query=bad+bunny` | Optional | Search YouTube |
| GET | `/songs/:id/generate-playlist?limit=30` | Optional | Generate playlist from seed song |
| GET | `/songs/:id/generate-playlist?limit=30&search=sad+reggaeton` | Optional | Context-aware playlist |
| POST | `/songs/:id/refresh-metadata` | Optional | Refresh song metadata from Last.fm |

#### Pagination
```
GET /songs?page=1&pageSize=20
```

#### Trending response shape
```json
{
  "songs": [{ "id": "...", "title": "...", "artistName": "...", "youtubeId": "...", "thumbnailUrl": "...", "duration": 245, "rank": 1, "genres": ["Pop"], "tags": [] }],
  "mixes": [{ "title": "...", "youtubeId": "...", "thumbnailUrl": "...", "rank": 1, "genres": ["Pop"] }],
  "videos": [...],
  "artists": [...]
}
```

---

### Artists

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/artists` | Required | List artists |
| GET | `/artists/:id` | Required | Get artist by ID |
| GET | `/artists/:id/songs` | Required | Artist's songs |
| GET | `/artists/:id/albums` | Required | Artist's albums |

---

### Albums

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/albums` | Required | List albums |
| GET | `/albums/:id` | Required | Get album by ID |

---

### Playlists (requires login)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/playlists` | Required | Create playlist |
| GET | `/playlists` | Required | Get user's playlists |
| DELETE | `/playlists/:id` | Required | Delete playlist (owner only) |
| POST | `/playlists/:id/songs` | Required | Add song to playlist |
| DELETE | `/playlists/:id/songs/:songId` | Required | Remove song from playlist |

#### Create playlist body
```json
{ "name": "My Playlist" }
```

#### Add song body
```json
{ "songId": "firestore-song-id" }
```

---

### Search & Suggestions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/search?q=rock` | Required | Search across all entities |
| GET | `/suggestions?q=ro` | Optional | Autocomplete suggestions (min 2 chars) |

#### Search response
```json
{
  "songs": [...],
  "artists": [...],
  "albums": [...],
  "playlists": [...]
}
```

#### Suggestion item shape
```json
{ "id": "...", "name": "...", "type": "song" | "artist" | "album" | "playlist" }
```

---

### Sync (admin only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/sync/trigger` | Admin | Trigger music sync |

#### Sync body
```json
{ "genres": ["Rock", "Pop"], "force": false }
```

---

## 4. Permissions

Permissions are stored as Firebase custom claims (`permissions: string[]`).

### Known permissions
| Permission | Description |
|------------|-------------|
| `suggest_playlists` | Access to AI playlist suggestions |
| `offline_play` | Access to offline playback features |

### Check permission in Flutter
```dart
Future<bool> hasPermission(String permission) async {
  final user = FirebaseAuth.instance.currentUser;
  if (user == null) return false;
  final token = await user.getIdTokenResult();
  final permissions = token.claims?['permissions'] as List<dynamic>? ?? [];
  return permissions.contains(permission);
}
```

### Usage example
```dart
if (await hasPermission('suggest_playlists')) {
  // show playlist suggestion UI
}
```

### After permission is granted by admin
```dart
// Force token refresh to get updated claims
await FirebaseAuth.instance.currentUser?.getIdToken(true);
```

---

## 5. Error Handling

All errors follow this shape:
```json
{
  "statusCode": 400,
  "message": "Validation error message",
  "timestamp": "2026-04-27T10:00:00.000Z"
}
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation error |
| 401 | Missing or invalid token |
| 403 | Forbidden (wrong owner or missing permission) |
| 404 | Resource not found |
| 500 | Internal server error |

---

## 6. Flutter Tasks Checklist

- [ ] Add Firebase dependencies to `pubspec.yaml`
- [ ] Initialize Firebase in `main.dart`
- [ ] Implement `getToken()` helper that auto-refreshes
- [ ] Implement `ApiService` with base URL and auth header injection
- [ ] Implement Google Sign-In (or email/password) flow
- [ ] Call `getIdToken(forceRefresh: true)` after login to get latest claims
- [ ] Implement `hasPermission(permission)` helper using `getIdTokenResult()`
- [ ] Integrate `GET /songs/trending` for home screen
- [ ] Integrate `GET /songs/search-youtube?query=` for search screen
- [ ] Integrate `GET /suggestions?q=` for search autocomplete
- [ ] Integrate `GET /songs/:id/generate-playlist?search=` for playlist generation
- [ ] Integrate `POST /playlists` and `GET /playlists` for user playlists
- [ ] Gate playlist suggestion UI behind `suggest_playlists` permission check
- [ ] Gate offline download UI behind `offline_play` permission check
- [ ] Handle 401 responses by redirecting to login screen
- [ ] Handle 403 responses by showing permission-denied UI
