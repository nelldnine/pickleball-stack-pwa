# Pickleball Stacking — Implementation Guide

A mobile-first PWA for running a pickleball doubles session: roster management, fair
team pairing, live scorekeeping across one or more courts, doubles "stacking"
positions, and session history/standings. Fully client-side — no backend, no
accounts; all data lives in the browser (IndexedDB) and can be exported/imported
as JSON.

This document describes what to build and how the pieces fit together, so it can
be implemented from scratch in any stack. Code-level detail is given only where
the logic is non-obvious (the fairness algorithm, stacking positions, multi-court
state model); everything else is described at the level of "what it does and why."

---

## 1. Tech stack

- React 19 + TypeScript, built with Vite
- Tailwind CSS v4 (CSS-variable-based theme, see §7)
- Zustand for app state
- Dexie (IndexedDB wrapper) for persistence
- `vite-plugin-pwa` for installability (manifest + service worker)
- Web Speech API (optional, progressively enhanced) for hands-free scoring

Any equivalent stack works (e.g. a different state library, a SQL-backed mobile
app, etc.) — the important thing to preserve is: **all state changes go through
one central store, which is the only thing that talks to persistence.**

### Project setup

1. Scaffold a Vite + React + TypeScript app.
2. Add Tailwind v4 (`@tailwindcss/vite` plugin, `@import 'tailwindcss'` in the
   global stylesheet — no separate `tailwind.config.js` needed for basic usage).
3. Add `dexie`, `zustand`.
4. Add `vite-plugin-pwa` and configure a manifest (name, short_name, description,
   theme/background colors, icons, `display: 'standalone'`,
   `orientation: 'portrait'`).
5. Set the viewport meta tag with `viewport-fit=cover` and add safe-area-aware
   padding in the layout (this app targets installed/full-screen mobile use).
6. Set up strict TypeScript (`noUnusedLocals`, `noUnusedParameters`,
   `noFallthroughCasesInSwitch`) and a linter (oxlint or eslint) with at least
   `react-hooks/rules-of-hooks` enabled as an error.
7. `npm run build` should run a type-check before bundling — there's no test
   suite, so the type checker is the main safety net. Wire it as
   `tsc -b && vite build`.

---

## 2. Data model

```ts
type Handedness = 'right' | 'left'
type SidePreference = 'ad' | 'deuce' | 'flexible'

interface Player {
  id: string
  name: string
  handedness: Handedness
  sidePreference: SidePreference
  active: boolean        // currently available to be picked for a game
  createdAt: number
}

interface TeamAssignment {
  teamA: [string, string] // player ids
  teamB: [string, string]
}

interface StackingConfig {
  enabled: boolean
  sides: Record<string, SidePreference> // player id -> side they stack to
}

type PointEvent = { team: 'A' | 'B'; timestamp: number }

interface Game {
  id: string
  createdAt: number
  finishedAt: number | null
  playerIds: string[]      // all 4 players, flattened
  teams: TeamAssignment
  stacking: StackingConfig
  scoreA: number
  scoreB: number
  history: PointEvent[]     // append-only point log, enables "undo last point"
  status: 'setup' | 'live' | 'finished'
  court?: number            // 1-indexed; absent/1 for single-court data
}

interface PlayerStats {
  playerId: string
  gamesPlayed: number
  totalPoints: number
  wins: number
  losses: number
  lastPlayedAt: number | null
  courtTimeMs: number
  partnerCounts: Record<string, number> // partnerId -> times paired together
}
```

`PlayerStats` is never stored — it's derived on the fly from `players` + `games`
(see §4). This keeps the persisted model simple and means changing the stats
formula never requires a migration.

### Persistence tables

- `players` — one row per `Player`, indexed on `id, name, active, createdAt`.
- `games` — one row per `Game`, indexed on `id, status, createdAt, finishedAt`.
- `settings` — a plain key/value table for small app-level settings that should
  survive reloads and travel with a backup export. Two keys are used:
  - `courtCount: number` — how many courts are configured (default `1`).
  - `seasonStartedAt: number | null` — see §6 (standings reset).

Use a schema-versioned migration mechanism (Dexie's `.version()` chain, or
equivalent) so new tables/indexes can be added later without breaking existing
installs. Adding a field to an interface (like `Game.court`) doesn't need a
migration as long as it's optional and code treats `undefined` as the default.

---

## 3. Central store

One store owns all state and is the *only* thing that reads/writes persistence.
Components never talk to the database directly — they read reactive state and
call store actions.

State shape:

```
players: Player[]
games: Game[]
loaded: boolean
courtCount: number
seasonStartedAt: number | null
```

Actions (each writes to persistence, then updates in-memory state):

- `load()` — read everything from persistence on app start; sets `loaded: true`.
- `addPlayer(name, handedness)`, `setPlayerActive(id, active)`, `removePlayer(id)`
- `setCourtCount(count)` — clamp to a sane range (e.g. 1–6).
- `startGame(teams, stackingEnabled, sides, court)` — creates a `Game` with
  `status: 'live'`, `scoreA/scoreB: 0`, empty history.
- `addPoint(gameId, team)` — increments that team's score and appends a
  `PointEvent`.
- `undoLastPoint(gameId)` — pops the last `PointEvent` and decrements the
  matching score. No-op if history is empty.
- `finishGame(gameId)` — sets `status: 'finished'` and `finishedAt`.
- `resetStandings()` — sets `seasonStartedAt = now`. Non-destructive.
- `clearHistory()` — permanently deletes all `finished` games and clears
  `seasonStartedAt`. Destructive — the UI must confirm before calling this.
- `exportData()` / `importData(data)` — full round-trip of `players`, `games`,
  and `settings` as plain JSON, used for backup/restore. Keep this in sync
  whenever new persisted state is added.

**State-derivation gotcha (applies to any selector-based state library):** never
have a selector *compute and return a new array/object* on every call (e.g.
`useStore(s => s.games.filter(...))`) — if the library re-renders on reference
inequality, this creates a new reference every render and can produce an
infinite render loop. Only select stable references (raw fields) from the
store and do any filtering/derivation with a memoized computation
(`useMemo`/`computed`/selector-library-with-equality-check) in the component or
a shared derivation function.

---

## 4. Core algorithms (pure functions, no framework dependency)

### 4.1 Stats derivation — `computeStats(players, games)`

For every player, walk every non-`'setup'` game and accumulate:

- `gamesPlayed` — count of games the player appears in (`status` live or
  finished).
- `courtTimeMs` — `finishedAt - createdAt` if finished; otherwise estimate using
  `history.length * AVG_POINT_MS` (pick a reasonable constant, e.g. 25s/point)
  as a rough proxy for an in-progress game's duration.
- `totalPoints`, `wins`, `losses` — from `scoreA`/`scoreB` and which team the
  player was on; a win/loss is only counted once the game is `finished`.
- `lastPlayedAt` — max of `finishedAt ?? createdAt` across the player's games.
- `partnerCounts` — for each game, bump the count between the two players on
  each team (both directions).

### 4.2 Session filter — `sessionGames(games, seasonStartedAt)`

Used everywhere `computeStats` is called for "current standings" (as opposed to
full-history export). Returns:

- all `games` if `seasonStartedAt` is null (no reset has ever happened), else
- only games where `status === 'live'` **or** `createdAt >= seasonStartedAt`.

The `status === 'live'` clause matters: a game that started just before a reset
click must not disappear from the screen mid-play.

### 4.3 Fairness — who plays next

`rankByFairness(players, stats)`:
1. Filter to `active` players.
2. Sort ascending by: `gamesPlayed`, then `courtTimeMs`, then `lastPlayedAt`
   (nulls treated as "never played", i.e. highest priority).
3. Assign a `priority` (rank) to each.

`pickNextPlayers(players, stats, count)` — take the top `count` from the
ranking above. This is the "auto-suggested next four."

### 4.4 Fairness — how to split 4 players into teams

Given exactly 4 player ids `[p1, p2, p3, p4]`, there are exactly 3 ways to split
them into two pairs:

```
{A: [p1,p2], B: [p3,p4]}
{A: [p1,p3], B: [p2,p4]}
{A: [p1,p4], B: [p2,p3]}
```

`rankedTeamSplits(fourPlayerIds, stats, lockedPairs)`:
1. Generate the 3 splits above.
2. If a `lockedPair` (e.g. two players who must stay on the same team, such as a
   couple) matches two of the four ids, filter to only splits that keep them
   together.
3. Score each split by `partnerCounts[a][b] + partnerCounts[c][d]` (sum of how
   many times each pair has already played together) — lower is better, since
   the goal is to avoid repeat pairings.
4. Sort ascending by that score and return all valid splits, best first.

`suggestTeams(...)` is just the first (best) entry from the above — used as the
default; the UI also lets the user cycle through the other ranked splits
("Try another pairing") and drag/tap a player to swap them to the other team
(implemented as: lock that player with the target partner and recompute).

### 4.5 Doubles stacking — `courtPositionsForScore(teams, stackingConfig, servingTeam, serverId, servingScore)`

"Stacking" is a doubles strategy where a team's two players don't necessarily
stand in their assigned service-court side; instead each player can prefer a
fixed side (`deuce`/`ad`) regardless of score, and the partner fills the other
side. Implement this as:

1. For each of the 4 players, determine which side (`left`/`right` — i.e.
   deuce/ad) they occupy for the *current* score, given:
   - If `stackingConfig.enabled` is false, or the player's preference is
     `flexible`, fall back to standard pickleball positioning: server on the
     side matching the parity of their team's score (even score → right/deuce
     side, odd → left/ad side); the partner takes the other side.
   - If the player has a fixed `sides[playerId]` preference (`ad`/`deuce`),
     they always stand there, and their partner is placed on the remaining
     side.
2. Return one entry per player: `{ playerId, team, stackedSide, role
   ('server' | 'receiver' | 'partner'), requiredSide }` so the UI can render a
   2×2 court diagram and a text list ("must stand ad" vs. "free to stack").
   `requiredSide` is non-null only for the two players the rules actually pin
   down (the server, and the receiver diagonally opposite them); everyone else
   is free to stack.

**Critical invariant: a team's two players must never be assigned the same
`stackedSide`.** Two people cannot stand in one service court, and the diagram
renders one player per quadrant — so a collision silently erases a player from
the court view. This is reachable through ordinary input: if the server is
pinned to the deuce side by the score and their partner has *also* chosen
"deuce side," a naive implementation puts both on the right. Resolve it by
anchoring on the rules-mandated player (server/receiver) and forcing the
partner to the opposite side when their preference would collide. Verify this
exhaustively across every combination of the four players' preferences
(`ad`/`deuce`/`flexible`/unset), both serving teams, either player serving, and
both score parities.

This function is pure and only needs `teams`, `stacking`, which team is
serving, who the server is, and that team's current score. It deliberately does
not model server rotation (1st/2nd server) — teams track that themselves.

---

## 5. UI structure

Single-page app, bottom tab bar, no router (this is a small, always-authenticated,
local-only tool — a router adds nothing). Tabs:

- **Players** — add/remove players, toggle `active` ("Playing"), see handedness.
  Players currently in a live game are flagged "on court" and cannot be removed
  — deleting one would leave its scoreboard rendering `?` for a player that no
  longer exists.
- **Next Round** — the fairness engine's suggested 4 (editable), team split
  (with "try another pairing" / tap-to-swap / lock-a-pair-together), optional
  per-player stacking side, and a "Start Game" action. Also embeds itself
  (headed "Up Next") inside the History tab so you can queue the next game
  without leaving history.
- **Game** — live scoreboard(s): big tap targets for "add point," undo, finish,
  and (if enabled) the stacking court diagram + hand-signal picker (see §4.5).
  Renders **one scoreboard per currently-live game**, not just one (§6).
- **History** — per-player court-time/games-played standings, list of finished
  games, and backup (export/import JSON) + the standings-reset controls (§7).

App-level logic:
- On load, fetch everything from the store; show a loading state until ready.
- Auto-switch to the Game tab the moment any court goes live (a `useEffect`
  keyed on the *count* of live games, not the array reference, so it only
  fires on transition and doesn't fight manual navigation afterward).
- The bottom nav's Game tab shows a small badge dot when at least one game is
  live.

---

## 6. Multi-court support

Games are not tied to a single "current game" — any number of `Game`s can have
`status: 'live'` simultaneously, each tagged with a 1-indexed `court`. Derive
"live games" by filtering the games list (sorted by court number) wherever
needed — don't track a separate "current game id" field, since that doesn't
generalize past one court.

In the Next Round flow:
1. Compute the set of players already on a live court (`busyPlayerIds`, union of
   `playerIds` across live games) and exclude them from the pickable pool —
   otherwise the same player could be suggested for two courts at once.
2. Compute which court numbers are currently occupied (`busyCourts`) and which
   are free (`1..courtCount` minus `busyCourts`).
3. If `courtCount > 1`, show a court picker (segmented buttons), disabling
   occupied courts and defaulting the selection to the first free one.
4. If no courts are free, disable "Start Game" and explain why.
5. `startGame(..., court)` passes the chosen court through to the new `Game`.

In the Game tab, render every live game (stacked vertically works fine on
mobile), labeling each with its court number when there's more than one. When a
court's game finishes, only navigate away to History if it was the *last* live
game — otherwise stay put so the other court(s) keep scoring.

A `courtCount` stepper (± buttons, clamped 1–6) lives on the primary Next Round
tab and persists via the `settings` table.

---

## 7. Fresh standings per session ("new day")

Two distinct, clearly-separated actions (don't conflate them):

- **Reset standings** (non-destructive): sets `seasonStartedAt = now`. Every
  place that computes stats or "past games" for display must filter through
  `sessionGames()` (§4.2) instead of the raw `games` array, so old games drop
  out of the visible standings/history without being deleted — they're still in
  the database and still included in a full JSON export. Show a small "Since
  <timestamp>" note when a boundary is active, plus a text link to reset again.
- **Clear all history** (destructive): permanently deletes every `finished`
  game and clears the season boundary (there's nothing left to hide). Gate
  this behind an explicit confirmation, since it cannot be undone.

The fairness "who plays next" logic should also respect the session boundary —
otherwise resetting "standings" without also resetting what fairness considers
would be confusing (games from last week would still suppress players from
being picked). Feed `sessionGames(games, seasonStartedAt)` into `computeStats`
on the Next Round tab too, not just in History.

---

## 8. Theming

Define the palette and font tokens once as CSS custom properties (Tailwind v4's
`@theme` block does this automatically, mapping each `--color-*`/`--font-*`
declaration to a utility class), then override the color values under a
`prefers-color-scheme: dark` media query:

```css
@theme {
  --color-paper: #f6f5f3;   /* page ground */
  --color-surface: #ffffff; /* cards */
  --color-sunken: #eeece8;  /* pressed states, empty bar tracks */
  --color-line: rgba(20, 24, 26, 0.1);
  --color-ink: #14181a;
  --color-muted: #6a6f73;
  --color-faint: #9a9ea1;

  --color-court: #0f6b63;      /* structure + data */
  --color-court-soft: #d7e8e4;
  --color-flare: #ff5b2e;      /* live / now / next */
  --color-flare-ink: #2a0d02;  /* text on top of flare */

  --font-sans: 'Inter', system-ui, sans-serif;
  --font-display: 'Archivo', 'Inter', system-ui, sans-serif;
}

/* No [data-theme] means "follow the OS". An explicit choice pins color-scheme,
   which is what every light-dark() above resolves against — and it also re-skins
   native controls (<select>, scrollbars) to match, which swapping custom
   properties alone does not do. */
:root                    { color-scheme: light dark; }
:root[data-theme='light']{ color-scheme: light; }
:root[data-theme='dark'] { color-scheme: dark; }
```

Declaring each color once as `light-dark(light, dark)` is what makes the theme
toggle cheap: there is no second dark palette to keep in sync, and a token
*cannot* be missing its dark value. (Build tooling such as Lightning CSS
polyfills `light-dark()` into paired custom properties and rewrites the
`[data-theme]` rules to drive them, so support is broad — including for opacity
modifiers like `bg-court/55`.)

**Theme selection** is three-state — `system | light | dark`:

- `system` must **remove** the attribute rather than write a resolved value, so
  the CSS keeps following `prefers-color-scheme` live; also subscribe to that
  media query so the app re-themes if the OS flips while open.
- Store the choice **per device (localStorage), not in the app's backup data.**
  A theme is a display preference, so importing a teammate's export should never
  change your appearance.
- Apply any saved theme from a tiny inline script **before first paint**, or an
  explicit choice flashes the OS theme for a frame while the bundle loads.
- Keep "match system" as a real option rather than a plain two-way switch — most
  people want the app to follow their phone, and silently pinning a theme the
  first time someone taps takes that away.

**Give each accent exactly one job**, and don't let them drift:

- `court` (deep teal) — structure and data: the court surface, ledger bars,
  selected states, focus rings. Calm, informational.
- `flare` (orange) — *live / now / do this next* only: the live-game dot, the
  primary Start button, players owed court time. The moment it starts appearing
  on ordinary UI it stops meaning anything.

Both are drawn from the game's own materials (court surface, ball) rather than
picked as brand colors, which is why they read as belonging to this app.

**Typography** pairs a display face with the body face by *proportion* rather
than style, so they contrast without clashing: **Archivo** on its variable width
axis (expanded, tabular figures) for numerals and headings, **Inter** for dense
UI text. Numerals are the hero content here — scores, counts, minutes, read at
arm's length outdoors — so give them a dedicated class rather than just making
body text big:

```css
.readout { font-family: var(--font-display);
           font-variation-settings: 'wdth' 118;
           font-feature-settings: 'tnum' 1; }
.label   { font-family: var(--font-display);
           font-variation-settings: 'wdth' 108;
           text-transform: uppercase; letter-spacing: 0.09em; }
```

Components then use one set of classes (`bg-surface`, `text-text-soft`,
`border-border`, `bg-accent text-accent-ink`, etc.) that automatically adapt —
**do not** hand-write light/dark variant pairs on every element; that doubles
every class list and is easy to get inconsistent. If a component-scoped
override is ever needed, override the CSS variable in that scope, not the
utility classes.

Design notes that mattered in practice:

- **Make the product's purpose visible.** The app exists to divide court time
  fairly, but rendering that as a column of text (`4 games · 52 min`) hides the
  one thing the user actually needs. The signature element is a *fairness
  ledger*: one bar per player, sorted **least court time first**, with the group
  average marked, so the top of the list literally answers "who's up next" and
  an unfair gap is visible without reading a single number.
- **Only label the exception.** Show handedness solely when a player is
  left-handed; right-handed is the default and stamping it on every row is pure
  noise. Same rule for the "most owed" badge on the matchup — suppress it when
  all four players are level, because a badge on every row distinguishes nothing.
- **Spend boldness in one place.** The ledger is the memorable element; keep
  everything around it quiet — hairline borders, no shadows, no gradients.
- Use real iconography (small inline SVGs) rather than emoji for navigation —
  emoji render inconsistently across platforms and skew the tone younger than a
  utility app wants. Emoji are fine where they *are* the content: the ✊/✋
  stacking hand-signals are the literal gestures players use.
- **Dim only what is genuinely secondary.** The trailing team's score recedes,
  but at a tie both read at full weight — muting both makes a live game look
  disabled.
- A title bar that only repeats the app name earns nothing on a phone. Make it
  a session status strip (courts live, players free) or drop it.

---

## 9. Nice-to-have: voice scoring

Progressively enhance the scoreboard with the Web Speech API where available
(feature-detect; hide the control entirely if unsupported). Listen continuously
while enabled and match simple phrases (e.g. "team a" / "team b" / "undo") to
call the same `addPoint`/`undoLastPoint` actions the tap UI uses — voice input
should never bypass the store's single mutation path.

**Make the microphone exclusive across courts.** Each live scoreboard owns its
own recognizer, but there is only one mic: if two courts are listening at once,
a single "team a" is heard by both and scores a point on each game. Keep a
module-level reference to whichever recognizer is currently listening and stop
it when another starts; the stopped one's `onend` fires, so that scoreboard
drops out of its listening state on its own.

---

## 10. Backup / portability

`exportData()` returns `{ players, games, settings: { courtCount,
seasonStartedAt } }` as one JSON object; wire it to a "download as file" action
(construct a `Blob`, object URL, trigger an `<a download>` click). `importData`
does the reverse: validate the shape loosely (e.g. `Array.isArray(data.players)
&& Array.isArray(data.games)`) before bulk-writing, and merge settings only if
present, so older export files without a `settings` key still import cleanly.

Two easy mistakes here, both of which strand a stale standings boundary:

- Test for **key presence**, not truthiness. `if (data.settings?.seasonStartedAt)`
  treats an explicit `null` (a backup taken with no active boundary) the same as
  "absent," so importing it leaves the old local boundary in place. Use
  `'seasonStartedAt' in settings` and handle `null` as "clear it."
- After reconciling the settings table, **read the state back from persistence
  and treat it as authoritative** (`?? null` / `?? 1` for the defaults). Falling
  back to the previous in-memory value (`?? get().seasonStartedAt`) resurrects
  the very boundary the import just cleared.
