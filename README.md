# D&D 5e Movement Limiter & Undo

A Foundry VTT v13 module for the D&D 5e system.

- **Movement limit.** A token drag is limited to the actor's *remaining* movement for the movement action selected in Foundry (walk, fly, swim, climb, burrow). Movement already spent this turn is subtracted; when you switch modes the spent distance carries over, per the 5e rules.
- **Extra movement.** When a token's movement is used up, the next drag starts a new full allotment of the active speed, for Dash, Action Surge and other effects that grant more movement. While any movement remains, drags are limited to exactly that remainder. Optionally cap the number of extra allotments per turn.
- **Undo / redo moves.** Two buttons at the bottom of the Combat Tracker step the selected token back one recorded move (refunding the movement) and forward again. Shift+click the back button to return to the start of the turn.

Foundry's normal drag preview, collision, walls and placement still apply: the module only clamps the drag destination.

## How it works

Spent movement is derived from Foundry's own `TokenDocument#movementHistory` (the history you see when hovering a token). Foundry clears it at the start of the token's turn and removes entries when a movement is reverted, so there is no extra state to keep in sync: undoing a move refunds the budget, and revokes an extra allotment that move had started. Undo uses `TokenDocument#revertRecordedMovement`.

The drag limit works by wrapping the callbacks registered on each token's `MouseInteractionManager` (`dragLeftStart`, `dragLeftMove`, `dragLeftDrop`, `dragLeftCancel`).

## Installation

In Foundry's **Add-on Modules** tab choose **Install Module** and paste the manifest URL:

```
https://github.com/knkr03/dnd5e-movement-limiter/releases/latest/download/module.json
```

Then enable the module in your world.

## Settings

| Setting | Scope | Default | What it does |
|---|---|---|---|
| GM Bypasses Limit | World | Off | GM drags are never constrained |
| Outside Combat | World | Full speed per drag | Limit for tokens not in combat (or no limit) |
| Combatants Off Their Turn | World | Track movement | Limit when it is not their turn |
| Allow Extra Movement | World | On | New full allotment once movement is used up |
| Max Extra Allotments per Turn | World | 0 (unlimited) | Cap, e.g. 1 for one Dash |
| Used-Up Threshold | World | 0.5 | Remaining at or below this counts as used up (scene units) |
| Measure Zero-Cost Waypoints | World | On | Measure distance when a history step has cost 0 |
| Announce Extra Movement | Client | On | Notification when an allotment is granted |
| Show Undo/Redo Move Buttons | Client | On | Show the Combat Tracker buttons |
| Debug Logging | Client | Off | Log budgets and undo steps to the console |

## Notes and limitations

- The limit is a straight line from where the drag started. Terrain costs along the path are recorded by Foundry afterwards but are not pre-applied to the drag clamp.
- On gridded scenes, Foundry's snapping can place the token slightly past the clamp. Gridless scenes are exact.
- In multi-token drags only the grabbed token is limited.
- Foundry only records movement history for tokens in combat, so undo/redo applies to combatants.
- The redo list is held in memory on the client that performed the undo, and is discarded when a new move is made or the turn changes.
- The module relies on Foundry v13 internals (interaction callbacks, movement history). Test after core or system updates.

## Console API

`game.modules.get("dnd5e-movement-limiter").api` provides:

- `status(token)` shows speed, spent, remaining and allotments
- `history(token)` lists the recorded movements the budget is derived from
- `resetTurn(token)` clears the token's movement history (GM)
- `undo(all = false)`, `redo()`, `debug()`

## Development

No build step. Source is in `scripts/` (ES modules). To release: bump `version` in `module.json`, commit, then publish a GitHub release tagged `vX.Y.Z`. The workflow in `.github/workflows/release.yml` rewrites the manifest version and download URL for the tag and attaches `module.json` and `module.zip`.

## License

MIT
