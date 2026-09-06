# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — type-check (`tsc -b`) then production build; always run this (or at least `npx tsc -b`) after making changes, since there is no test suite to catch type/logic errors otherwise
- `npm run lint` — run oxlint (`.oxlintrc.json`: react, typescript, oxc plugins; `react/rules-of-hooks` is an error)
- `npm run preview` — preview the production build

There is no test suite in this repo.

## Architecture

This is a mobile-first, installable PWA (React 19 + TypeScript + Vite + Tailwind v4) for running pickleball doubles sessions: tracking a player roster, auto-generating fair team pairings, scoring live games across one or more courts, and keeping a running history/standings. All persistence is local — Dexie (IndexedDB) — there is no backend.

### Data flow

- `src/lib/db.ts` — Dexie database (`players`, `games`, `settings` tables). `settings` is a simple key/value table (currently `courtCount`, `seasonStartedAt`).
- `src/store/useAppStore.ts` — the single Zustand store; owns all app state (`players`, `games`, `courtCount`, `seasonStartedAt`) and every mutation, each of which writes to Dexie and then updates in-memory state. Components read state via `useAppStore((s) => s.foo)` and never talk to Dexie directly.
  - **Important Zustand gotcha**: selectors must return a stable reference (a field, or a `useMemo`'d derivation) — an inline `.filter()`/`.map()` inside a selector returns a new array every render and can cause infinite render loops.
- `src/types/models.ts` — core domain types: `Player`, `Game` (has `status: 'setup' | 'live' | 'finished'`, per-team scores/history, optional `court` number, optional `serve`), `TeamAssignment`, `StackingConfig`, `PlayerStats`, `ServeState`.
  - `serve` (`{ team, server: 1 | 2 }`) is the single source of truth for who is serving; read it through `serveOf(game)` in the store, which defaults games saved before serve tracking to `{ team: 'A', server: 2 }` (the 0-0-2 start). `Scoreboard` owns the controls (`setServe`, `sideOut`) and `CourtVisualizer` only reads it — it must not keep a local copy that can disagree with the scoreboard.
  - `cancelGame` **deletes** the game row instead of marking it. That is the point of cancelling: a kept row would still spend court time and a pairing in the ledger. `finishGame` is the one that records a result.
- `src/lib/stats.ts` — derives `PlayerStats` (games played, court time, wins/losses, partner counts) from `players` + `games`. `sessionGames(games, seasonStartedAt)` filters games down to the current "standings session" (everything since the last reset, plus any still-live game) — this is what powers the "fresh standings for a new day" behavior, and both `NextRoundPanel` and `History` must feed it (not raw `games`) into `computeStats`.
- `src/lib/fairness.ts` — pure functions for picking who plays next (`pickNextPlayers`, ranked by fewest games/court time/oldest last-played) and generating team splits that minimize repeat pairings (`rankedTeamSplits`, honoring optional locked-together pairs).
- `src/lib/stacking.ts` — computes on-court positions (`courtPositionsForScore`) from side preferences (`ad`/`deuce`/`flexible`) and the current score, used for doubles "stacking" strategy.
- `src/lib/speech.ts` — optional Web Speech API integration for hands-free scoring ("point a"/"point b"/"undo").

### Multi-court model

Games are not tied to a single "current game" — any number of games can have `status: 'live'` simultaneously, each tagged with a `court` number (1-indexed). `courtCount` (in `settings`) bounds how many courts are configurable. `App.tsx` derives `liveGames` from the store's `games` array (filtered + sorted by court) rather than tracking a separate "current game id". `NextRoundPanel` excludes players already on another live court from the next-pick pool and lets the user choose which free court a new game starts on.

### UI structure

`App.tsx` is a single-page app with bottom-tab navigation (`players` / `teams` / `game` / `history`, no router) rendering one top-level component per tab from `src/components/`. The Game tab renders one `Scoreboard` per currently-live game (stacked, labeled by court when there's more than one).

The shell is a full-height flex column: fixed header, `flex-1 min-h-0 overflow-y-auto` main, and the nav **in normal flow** at the end of the column, padded by `env(safe-area-inset-bottom)`. `#root` is `position: fixed; inset: 0` so a scrolling Safari toolbar can't resize the box under the nav.

The nav reaching the physical bottom of an installed iOS app rests on one rule in `src/index.css`: **`html { height: calc(100% + env(safe-area-inset-top)) }`** under `@media (display-mode: standalone)`. `apple-mobile-web-app-status-bar-style: black-translucent` extends the document up under the status bar but WebKit does not grow the layout viewport to match, so the page is short by exactly the top inset (59pt on a Pro Max) and the nav floats above a dead strip of that height. Adding the inset back to the document height is the fix; `100dvh`, `100%`, and `position: fixed` all report that same short viewport, so none of them can see the problem, let alone solve it.

Consequences worth knowing before editing any of it:

- **`#root` must not be `position: fixed`.** A fixed box lays out against the short viewport and re-creates the gap. It is `height: 100%` of the corrected document.
- **Do not "simplify" the status bar meta to `default`.** iOS ignores the manifest's `theme_color` and offers only white / black / black-translucent here, so `default` buys an opaque *white* bar — wrong above the dark theme — and gives up edge-to-edge.
- `html` is painted `surface` rather than `paper` so that any strip the document fails to cover reads as part of the nav. That is a backstop, not the fix.

`History` shows two lists that answer different questions and are ordered oppositely on purpose: **Court time** ascending (who is owed a game, the app's core job) and **Standings** descending by wins (who is winning). Standings lists only players with a finished game — 0-0 rows bury the result — and shares a place between identical records rather than inventing an order from tiebreakers.

### Theming and design system

Tailwind v4 tokens live in `src/index.css` under `@theme`. Every color is declared **once** as `light-dark(<light>, <dark>)`, which resolves against the `color-scheme` set on `:root` — so there is no duplicated dark palette that can drift, and a token physically cannot be missing its dark value. Components use one set of classes (`bg-surface`, `text-muted`, `border-line`, …) that adapt automatically — **do not add `dark:` variant classes**; change the token instead.

Theme selection (`src/lib/theme.ts`) is `system | light | dark`:

- `system` **removes** the `data-theme` attribute rather than writing a resolved value, so CSS keeps tracking `prefers-color-scheme` live (the hook also listens for OS changes while in this mode).
- `:root[data-theme='light'|'dark']` pins `color-scheme`, which beats the media query on specificity and also re-skins native controls (`<select>`, scrollbars) — that's why the toggle sets `color-scheme` rather than just swapping variables.
- It is stored in **localStorage, not the Dexie `settings` table**, because it is a per-device display preference and must not ride along in the JSON backup — importing a teammate's export should never change your appearance.
- An inline script in `index.html` applies a saved theme before first paint; without it an explicit choice flashes the OS theme for a frame. It duplicates the two chrome colors, so update both places if the palette changes.

Note: Lightning CSS (via Vite) polyfills `light-dark()` into `--lightningcss-light/dark` custom properties and rewrites the `[data-theme]` rules to drive them, so this works well beyond browsers with native `light-dark()` support, including with opacity modifiers like `bg-court/55`.

Two accent colors, each with one job — they are not interchangeable:

- `court` (deep teal) — structure and data: the court surface in the diagram, ledger bars, selected states, focus rings.
- `flare` (orange) — **"live / now / do this next" only**: the live-game dot, the primary Start button, players owed court time. Never decorative; if it starts appearing on ordinary UI it stops meaning anything.

Everything else is ink on paper (`ink`, `muted`, `faint`, `paper`, `surface`, `sunken`, `line`).

Typography pairs **Archivo** (variable width axis, expanded) with **Inter**. Two helper classes carry this:

- `.readout` — Archivo at `wdth 118` with tabular figures, for numerals and headings. Scores, counts, and minutes are the app's hero content and need to read from a few feet away.
- `.label` — Archivo, uppercase, wide tracking, for small eyebrow/meta text.

Design decisions worth preserving (they were deliberate, and each removed noise):

- The roster shows handedness **only when it's left**. Right-handed is the default; printing it on every row is noise, and only the exception changes stacking.
- The "most owed" badge on the Next Round matchup appears **only when it distinguishes someone**. If all four picked players are level it is suppressed — the same badge on every row explains nothing.
- The serve strip lives **inside** the score card, on its bottom edge, not in a card of its own — on a phone a separate panel read as a second screen to consult mid-rally. It holds only the call and Side out.
- The server is identified by **name**, bold in the team label on the score itself, and nowhere else. There is no 1st/2nd server picker: it named the same player the score already had in bold, and `sideOut` walks the serve through all four legal states (1st server, 2nd server, over to the other team, back) so the picker only ever saved a tap. The number is still readable as the last digit of the call, and the name resolves to a player the same way `CourtVisualizer` resolves it, so the two can't disagree.
- `setServe` is still on the store and is intentionally unused by the UI — the serve can only move the way the rules move it.
- The ledger sorts **ascending** (least court time first), so the top of the list answers "who's up next".
- The header is a session status strip (live courts / free players), not a repeated app title.

### App updates

`registerType` is **`prompt`**, not `autoUpdate`, and `src/lib/pwaUpdate.ts` owns the registration (`injectRegister: null`). A silent reload would pull the scoreboard away mid-game, so a waiting build surfaces as a banner above the nav plus an "App" section in `History`; `App.tsx` holds the hook and passes both down, because calling `useAppUpdate` twice would register the worker twice.

An installed iOS app is resumed from a frozen process and can go days without a page load, which is the only thing that triggers the default update check — that is what used to make a stale install look unfixable without deleting it. So the hook re-checks on an hourly timer, on every return to the foreground, and on demand.

The reload after skip-waiting is deliberately ours. `registerSW`'s built-in reload runs only when the `controlling` event reports `isUpdate`, which requires the page to have already been under a worker's control; on the first run after registering it is false, and the button would swap the build in invisibly and look broken. The hook reloads on `controllerchange` and falls back to a timer for the uncontrolled case.

### Backup / portability

`exportData`/`importData` in the store round-trip the full app state (players, games, and settings) as JSON, used by the Export/Import JSON buttons in `History`. Keep these in sync when adding new persisted state.
