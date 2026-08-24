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
- `src/types/models.ts` — core domain types: `Player`, `Game` (has `status: 'setup' | 'live' | 'finished'`, per-team scores/history, optional `court` number), `TeamAssignment`, `StackingConfig`, `PlayerStats`.
- `src/lib/stats.ts` — derives `PlayerStats` (games played, court time, wins/losses, partner counts) from `players` + `games`. `sessionGames(games, seasonStartedAt)` filters games down to the current "standings session" (everything since the last reset, plus any still-live game) — this is what powers the "fresh standings for a new day" behavior, and both `NextRoundPanel` and `History` must feed it (not raw `games`) into `computeStats`.
- `src/lib/fairness.ts` — pure functions for picking who plays next (`pickNextPlayers`, ranked by fewest games/court time/oldest last-played) and generating team splits that minimize repeat pairings (`rankedTeamSplits`, honoring optional locked-together pairs).
- `src/lib/stacking.ts` — computes on-court positions (`courtPositionsForScore`) from side preferences (`ad`/`deuce`/`flexible`) and the current score, used for doubles "stacking" strategy.
- `src/lib/speech.ts` — optional Web Speech API integration for hands-free scoring ("point a"/"point b"/"undo").

### Multi-court model

Games are not tied to a single "current game" — any number of games can have `status: 'live'` simultaneously, each tagged with a `court` number (1-indexed). `courtCount` (in `settings`) bounds how many courts are configurable. `App.tsx` derives `liveGames` from the store's `games` array (filtered + sorted by court) rather than tracking a separate "current game id". `NextRoundPanel` excludes players already on another live court from the next-pick pool and lets the user choose which free court a new game starts on.

### UI structure

`App.tsx` is a single-page app with bottom-tab navigation (`players` / `teams` / `game` / `history`, no router) rendering one top-level component per tab from `src/components/`. The Game tab renders one `Scoreboard` per currently-live game (stacked, labeled by court when there's more than one).

### Theming

Tailwind v4 tokens are defined in `src/index.css` via `@theme` as CSS custom properties (`--color-bg`, `--color-surface`, `--color-text`, `--color-accent`, etc.), with dark-mode values overridden under `@media (prefers-color-scheme: dark)`. Components use one set of classes (e.g. `bg-surface`, `text-text-soft`) that adapt automatically — do not add `dark:` variant classes; add/override the CSS variables instead.

### Backup / portability

`exportData`/`importData` in the store round-trip the full app state (players, games, and settings) as JSON, used by the Export/Import JSON buttons in `History`. Keep these in sync when adding new persisted state.
