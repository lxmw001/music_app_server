# Flutter Integration Guide — Music App API

## Base URL

```
Production: https://music-app-server-<hash>-uc.a.run.app
Local:      http://localhost:3000
```

---

## 1. Firebase Setup

### pubspec.yaml
```yaml
dependencies:
  firebase_core: ^3.x.x
  firebase_auth: ^5.x.x
  google_sign_in: ^6.x.x   # if using Google login
  http: ^1.x.x
```

### main.dart
```dart
void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(MyApp());
}
```

---

## 2. Auth Helper

Always call `getIdToken()` fresh before each request — it auto-refreshes when expired.

```dart
class ApiService {
  static const String baseUrl = 'https://your-cloud-run-url';

  Future<String?> _getToken() async {
    return await FirebaseAuth.instance.currentUser?.getIdToken();
  }

  Future<Map<String, String>> _headers({bool requiresAuth = true}) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (requiresAuth) {
      final token = await _getToken();
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<dynamic> get(String path, {bool requiresAuth = true}) async {
    final res = await http.get(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(requiresAuth: requiresAuth),
    );
    if (res.statusCode >= 400) throw ApiException.fromResponse(res);
    return jsonDecode(res.body);
  }

  Future<dynamic> post(String path, {Map<String, dynamic>? body, bool requiresAuth = true}) async {
    final res = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(requiresAuth: requiresAuth),
      body: body != null ? jsonEncode(body) : null,
    );
    if (res.statusCode >= 400) throw ApiException.fromResponse(res);
    return res.statusCode == 204 ? null : jsonDecode(res.body);
  }

  Future<dynamic> delete(String path, {bool requiresAuth = true}) async {
    final res = await http.delete(
      Uri.parse('$baseUrl$path'),
      headers: await _headers(requiresAuth: requiresAuth),
    );
    if (res.statusCode >= 400) throw ApiException.fromResponse(res);
    return null;
  }
}

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  factory ApiException.fromResponse(http.Response res) {
    final body = jsonDecode(res.body);
    return ApiException(res.statusCode, body['message']?.toString() ?? 'Unknown error');
  }
}
```

---

## 3. Permissions

Permissions are Firebase custom claims set by an admin. Check them from the token result.

```dart
Future<bool> hasPermission(String permission) async {
  final result = await FirebaseAuth.instance.currentUser?.getIdTokenResult();
  final perms = result?.claims?['permissions'] as List<dynamic>? ?? [];
  return perms.contains(permission);
}

// After admin grants a permission, force-refresh the token:
await FirebaseAuth.instance.currentUser?.getIdToken(true);
```

### Available permissions
| Permission | Feature |
|------------|---------|
| `suggest_playlists` | AI playlist suggestions |
| `offline_play` | Offline download/playback |

---

## 4. API Reference

### Error shape (all 4xx/5xx)
```json
{ "statusCode": 404, "message": "Song not found", "timestamp": "2026-04-27T10:00:00.000Z" }
```

---

### Songs

#### `GET /songs?page=1&pageSize=20`
List songs with pagination. Auth optional.
```dart
final data = await api.get('/songs?page=1&pageSize=20', requiresAuth: false);
// Returns: List of SongResponse
```

#### `GET /songs/:id`
Get a single song. Auth optional.
```dart
final data = await api.get('/songs/$songId', requiresAuth: false);
```

**SongResponse shape:**
```json
{
  "id": "abc123",
  "title": "Song Title",
  "artistName": "Artist",
  "artistId": "artist-id",
  "albumId": "album-id",
  "durationSeconds": 245,
  "coverImageUrl": "https://...",
  "youtubeId": "yt-abc",
  "genre": "Pop",
  "tags": ["pop", "2024"]
}
```

#### `GET /songs/trending?country=EC&limit=50`
Most viewed music videos from the last 7 days. Auth optional.
```dart
final data = await api.get('/songs/trending?country=EC', requiresAuth: false);
// Returns: SearchYouTubeResponse
```

Add `&force=true` to bypass cache and fetch fresh from YouTube.

#### `GET /songs/search-youtube?query=bad+bunny`
Search YouTube and classify results. Auth optional.
```dart
final data = await api.get('/songs/search-youtube?query=${Uri.encodeComponent(query)}', requiresAuth: false);
// Returns: SearchYouTubeResponse
```

**SearchYouTubeResponse shape:**
```json
{
  "songs": [
    {
      "id": "firestore-id",
      "title": "Song Title",
      "artistName": "Artist",
      "youtubeId": "abc123",
      "thumbnailUrl": "https://...",
      "duration": 245,
      "rank": 1,
      "genres": ["Reggaeton", "Latin"],
      "tags": ["urban", "2024"],
      "album": "Album Name",
      "listeners": 5000000
    }
  ],
  "mixes": [{ "title": "Mix Title", "youtubeId": "xyz", "thumbnailUrl": "https://...", "rank": 1, "genres": ["Pop"] }],
  "videos": [{ "title": "Video Title", "youtubeId": "def", "thumbnailUrl": "https://...", "rank": 1 }],
  "artists": [{ "id": "artist-id", "name": "Artist", "imageUrl": "https://...", "rank": 1 }]
}
```

#### `GET /songs/:id/generate-playlist?limit=30&search=sad+reggaeton`
Generate a playlist from a seed song. `search` is optional — when provided, Gemini uses it as mood/vibe context. Auth optional.
```dart
final data = await api.get('/songs/$songId/generate-playlist?limit=30&search=${Uri.encodeComponent(search)}');
// Returns: List of SearchSongDto
```

#### `POST /songs/:id/refresh-metadata`
Refresh a song's metadata from Last.fm. Auth optional.
```dart
await api.post('/songs/$songId/refresh-metadata');
```

---

### Artists

All require auth.

| Endpoint | Description |
|----------|-------------|
| `GET /artists?page=1&pageSize=20` | List artists |
| `GET /artists/:id` | Get artist |
| `GET /artists/:id/songs` | Artist's songs |
| `GET /artists/:id/albums` | Artist's albums |

**ArtistResponse shape:**
```json
{ "id": "...", "name": "Artist Name", "biography": "...", "profileImageUrl": "https://..." }
```

---

### Albums

All require auth.

| Endpoint | Description |
|----------|-------------|
| `GET /albums?page=1&pageSize=20` | List albums |
| `GET /albums/:id` | Get album |

**AlbumResponse shape:**
```json
{ "id": "...", "title": "Album Title", "releaseYear": 2024, "coverImageUrl": "https://...", "artistId": "..." }
```

---

### Search & Suggestions

#### `GET /search?q=rock`
Search across songs, artists, albums, and playlists. Requires auth.
```dart
final data = await api.get('/search?q=${Uri.encodeComponent(query)}');
// Returns: { songs: [...], artists: [...], albums: [...], playlists: [...] }
```

#### `GET /suggestions?q=ro`
Autocomplete suggestions. Minimum 2 characters. Auth optional.
```dart
final data = await api.get('/suggestions?q=${Uri.encodeComponent(query)}', requiresAuth: false);
// Returns: List of { id, name, type: "song"|"artist"|"album"|"playlist" }
```

---

### Playlists

All require auth.

#### `GET /playlists`
Get all playlists owned by the authenticated user.
```dart
final data = await api.get('/playlists');
// Returns: List of PlaylistResponse
```

#### `GET /playlists/:id`
Get a single playlist with its song IDs.
```dart
final data = await api.get('/playlists/$playlistId');
```

**PlaylistResponse shape:**
```json
{
  "id": "playlist-id",
  "name": "My Playlist",
  "description": null,
  "ownerUid": "firebase-uid",
  "type": "user",
  "createdAt": { "seconds": 1714000000, "nanoseconds": 0 },
  "songs": ["songId1", "songId2", "songId3"]
}
```

#### `GET /playlists/:id/songs`
Get ordered song IDs for a playlist.
```dart
final List<String> songIds = await api.get('/playlists/$playlistId/songs');
```

#### `POST /playlists`
Create a new playlist.
```dart
final data = await api.post('/playlists', body: { 'name': 'My Playlist', 'description': 'Optional' });
// Returns: PlaylistResponse (without songs field)
```

#### `POST /playlists/:id/songs`
Add a song to a playlist.
```dart
await api.post('/playlists/$playlistId/songs', body: { 'songId': songId });
```

#### `DELETE /playlists/:id/songs/:songId`
Remove a song from a playlist.
```dart
await api.delete('/playlists/$playlistId/songs/$songId');
```

#### `DELETE /playlists/:id`
Delete a playlist (owner only). Returns 204.
```dart
await api.delete('/playlists/$playlistId');
```

---

### User Data (liked songs, downloads)

All require auth. All scoped to the authenticated user automatically.

#### `GET /users/me`
Get full user profile.
```dart
final data = await api.get('/users/me');
```

**Profile shape:**
```json
{
  "uid": "firebase-uid",
  "likedSongs": ["songId1", "songId2"],
  "downloadedSongs": ["songId3"],
  "updatedAt": "2026-04-27T10:00:00.000Z"
}
```

#### `GET /users/me/liked-songs`
Get list of liked song IDs.
```dart
final List<String> liked = await api.get('/users/me/liked-songs');
```

#### `GET /users/me/liked-songs/:songId`
Check if a specific song is liked.
```dart
final data = await api.get('/users/me/liked-songs/$songId');
// Returns: { "liked": true }
```

#### `POST /users/me/liked-songs/:songId`
Like a song.
```dart
final data = await api.post('/users/me/liked-songs/$songId');
// Returns: { "likedSongs": ["songId1", "songId2"] }
```

#### `DELETE /users/me/liked-songs/:songId`
Unlike a song.
```dart
await api.delete('/users/me/liked-songs/$songId');
```

#### `GET /users/me/downloads`
Get list of downloaded song IDs.
```dart
final List<String> downloads = await api.get('/users/me/downloads');
```

#### `POST /users/me/downloads/:songId`
Mark a song as downloaded (call after local download completes).
```dart
await api.post('/users/me/downloads/$songId');
```

#### `DELETE /users/me/downloads/:songId`
Remove a download record (call when user deletes local file).
```dart
await api.delete('/users/me/downloads/$songId');
```

---

## 5. Flutter Implementation Checklist

### Setup
- [ ] Add Firebase dependencies to `pubspec.yaml`
- [ ] Initialize Firebase in `main.dart`
- [ ] Implement `ApiService` with token injection and error handling
- [ ] Implement `hasPermission(permission)` helper

### Auth
- [ ] Implement Google Sign-In (or email/password) flow
- [ ] On login, call `getIdToken(forceRefresh: true)` to get latest claims
- [ ] Handle 401 → redirect to login screen
- [ ] Handle 403 → show permission-denied UI

### Home Screen
- [ ] `GET /songs/trending?country=EC` for trending songs
- [ ] `GET /suggestions?q=` for search autocomplete

### Search Screen
- [ ] `GET /songs/search-youtube?query=` for full search results
- [ ] `GET /search?q=` for cross-entity search

### Song Detail / Player
- [ ] `GET /songs/:id` for song details
- [ ] `GET /users/me/liked-songs/:songId` to show liked state
- [ ] `POST/DELETE /users/me/liked-songs/:songId` for like toggle
- [ ] `GET /songs/:id/generate-playlist?search=` for "More like this"

### Playlists Screen
- [ ] `GET /playlists` to list user playlists
- [ ] `GET /playlists/:id` to open a playlist
- [ ] `GET /playlists/:id/songs` then `GET /songs/:id` for each to load songs
- [ ] `POST /playlists` to create a new playlist
- [ ] `POST /playlists/:id/songs` to add a song
- [ ] `DELETE /playlists/:id/songs/:songId` to remove a song
- [ ] `DELETE /playlists/:id` to delete a playlist

### Downloads (requires `offline_play` permission)
- [ ] Check `hasPermission('offline_play')` before showing download UI
- [ ] `GET /users/me/downloads` to load downloaded song IDs on app start
- [ ] `POST /users/me/downloads/:songId` after local download completes
- [ ] `DELETE /users/me/downloads/:songId` when user removes local file

### Artists & Albums
- [ ] `GET /artists/:id` for artist profile
- [ ] `GET /artists/:id/songs` for artist's songs
- [ ] `GET /albums/:id` for album detail
