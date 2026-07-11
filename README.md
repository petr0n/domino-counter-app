# Domino Counter

> **Status:** This is the **Phase 2** product vision — the multiplayer game
> layer built once the scanner (tile detection + pip counting) clears its
> accuracy gates. See [`docs/build-plan-v2.md`](docs/build-plan-v2.md) for the
> active Phase 1 scanner build. Tech stack and implementation details will be
> added here once Phase 2 begins.

A companion scoring app for Mexican Train Dominoes. Keep track of scores across your IRL game by scanning tiles with your phone's camera — no more counting pips by hand or keeping track of paper score sheets.

## How It Works

1. **Start a game** — The game manager creates a new game session. The app generates a 5-character code.
2. **Join the game** — Other players enter the code and their name to join. Players can join at any time, even after the game has started.
3. **Play your round** — Play Mexican Train as usual. When the round ends:
   - The **winner** taps to mark themselves as the round winner (only one winner per round).
   - Every **non-winner** scans their remaining tiles using their phone's camera.
4. **Scan your tiles** — The app analyzes the photo, detects each tile, and counts the pips on every side. The results display below the photo with each tile cropped and labeled with its pip count.
5. **Review and submit** — Check the detected scores. Edit if needed, then hit submit to save.
6. **See the standings** — After each score is submitted, all players see the updated scores on their screen.

## Round Structure

Each round starts with a specific double placed in the center hub. The starting double progresses through the full double-12 set and back:

| Rounds | Starting Double |
|--------|----------------|
| 1      | 0/0            |
| 2      | 1/1            |
| ...    | ...            |
| 13     | 12/12          |
| 14     | 12/12          |
| ...    | ...            |
| 26     | 0/0            |

The app tracks which round you're on and displays the current starting double so your physical game stays in sync.

## Scoring

- **Round winner** (first to empty their hand): **0 points**
- **Everyone else**: Sum of all pips on their remaining tiles
- Scores are cumulative across all rounds
- Lowest total score at the end wins

## Game Manager Controls

The game manager has two extra capabilities:

- **Start a new round** — Advances the game to the next round and starting double.
- **Remove a player** — Remove someone from the game session.

## Rejoining a Game

Lost your tab or crashed browser? No problem. Just enter the same 5-character game code — your score and history are still there.

## Player Limits

- Up to **6 players** per game session.
- Players can join at any point during the game.
