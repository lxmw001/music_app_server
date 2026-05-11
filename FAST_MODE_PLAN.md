# Plan: Implementing "Fast Mode" (AI-Powered Quick Vibes)

This plan outlines the implementation of **Fast Mode**, a feature that provides personalized, context-aware music recommendations using user data (age, taste) and AI (Gemini).

## 1. Feature Concepts & Data Inputs

### User Data (Collected via Onboarding)
- **Birth Year**: Used to calculate "Nostalgia" eras.
- **Top 3 Genres**: Initial preference seeding (e.g., Rock, Electronic, Lofi).
- **Activity Level**: (Optional) To distinguish between "High Energy" or "Low Energy" preferences.

### Contextual Inputs (Automatic)
- **Time of Day**: Morning (6am-10am), Afternoon, Evening, Late Night.
- **Day of Week**: Weekday (Focus/Work) vs. Weekend (Relax/Party).
- **Date/Season**: Holidays (Christmas), Summer vibes, or Monthly hits.

### AI Role (Gemini)
The server will use Gemini to translate `(User Data + Context + Vibe ID)` into a specialized list of search queries or specific song titles.

---

## 2. Technical Architecture

### Phase 0: Premium Access Control (New)
- **Feature Flag**: Fast Mode is restricted to users with the `isPremium` claim.
- **Client Check**: `MusicPlayerProvider` will check user claims before allowing AI-vibe requests.
- **UI Feedback**: Non-premium users see a "Premium" badge or an upsell dialog when trying to use Fast Mode.

### Phase 1: User Onboarding Screen
- **NEW**: `lib/screens/onboarding_screen.dart`
- A one-time screen (or accessible from settings) to collect `birthYear` and `favoriteGenres`.
- Persistent storage using `SharedPreferences`.

### Phase 2: Server-Side AI Integration (Music Server)
- **Endpoint**: `POST /vibe/generate`
- **Payload**:
  ```json
  {
    "vibeId": "work",
    "birthYear": 1990,
    "genres": ["Rock", "Lofi"],
    "localTime": "2024-05-20T09:00:00",
    "dayOfWeek": "Monday"
  }
  ```
- **Gemini Prompt Logic**: 
  > "As a music expert, the user is a 34-year-old who likes Rock and Lofi. It's Monday morning. They tapped 'Work' vibe. Suggest 10 specific YouTube search queries to create a 'Monday Morning Focus' playlist. Include some 2000s nostalgia."

### Phase 3: Client-Side Implementation
- **Provider**: `MusicPlayerProvider.playFastMode(vibeId)`
  1. Gather local state (age, preferences, current time).
  2. Call `MusicServerService.getVibePlaylist(...)`.
  3. Receive a list of YouTube IDs or search queries.
  4. Sequence them into the player queue.

---

## 3. Implementation Steps

### Step 1: Data Models & Storage
- [ ] Create `lib/models/user_profile.dart`.
- [ ] Implement `ProfileService` to save/load user data.

### Step 2: Onboarding UI
- [ ] Build `OnboardingScreen` with:
  - Year picker (Birth Year).
  - Multi-select chips for Genres.
- [ ] Update `main.dart` to show onboarding if `birthYear` is missing.

### Step 3: Server Service Expansion
- [ ] Update `lib/services/music_server_service.dart`:
  - Add `fetchAIVibe(VibeRequest request)`.
  - Handle the mapping from AI suggestions to `Song` objects.
- [ ] **NEW**: Implement claim verification in the server-side endpoint to ensure only authorized users can call Gemini.

### Step 4: Home Screen Integration
- [ ] Create `FastModeSection` widget.
- [ ] Display "Smart Vibes" that change based on time:
  - *Morning*: "Morning Focus", "Early Energy".
  - *Late Night*: "Deep Sleep", "Midnight Melancholy".
- [ ] Add lock icons or "Premium" badges for unauthorized users.

---

## 4. Vibe Examples (AI Prompt Variations)

| Vibe ID | Sub-Category | Context | AI Influence |
| :--- | :--- | :--- | :--- |
| `focus` | N/A | Weekday 9 AM | "Productive Lofi + Soft 90s Instrumental Rock" |
| `exercise` | `HIIT / Cardio` | Anytime | "High BPM (140+), Hard Rock, Phonk, or Techno" |
| `exercise` | `Yoga / Stretch` | Evening | "Ambient Soundscapes, Tibetan Bowls, Soft Flute" |
| `party` | `Club / Dance` | Friday Night | "Modern House, EDM Hits, Bass-heavy tracks" |
| `party` | `Chill / Dinner` | Weekend | "Bossa Nova, Soul, Nu-Jazz, Vocal Classics" |
| `nostalgia` | N/A | Any | "Top 10 hits from year [Age+16]" |
| `seasonal` | N/A | December | "Jazz covers of Winter classics + User Genres" |

---

## 5. UI Structure for Categorized Vibes

To handle sub-categories (like Exercise -> HIIT), the `FastModeSection` will use a two-step interaction or a categorized grid:
1. **Top Level**: Big icons for "Exercise", "Party", "Focus", "Nostalgia".
2. **Sub-Menu (Optional)**: If a user taps "Exercise", a small overlay or expanded row shows "HIIT", "Strength", "Yoga".
3. **AI Payload**: The `subCategory` is sent to the server to refine the Gemini prompt.

---

## 6. Next Actions
1. [ ] Create `lib/screens/onboarding_screen.dart`.
2. [ ] Modify `main.dart` for initial routing.
3. [ ] Define the `MusicServer` API contract for AI vibes.
