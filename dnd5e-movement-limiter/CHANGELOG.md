# Changelog

## Unreleased

- Shift to release: holding Shift while dragging a token lifts the movement constraint for that drag. The release lasts until the token is placed, even if Shift is released first, and the next drag is limited again. Can be turned off with a new client setting.
- The release is published to other modules: `api.status(token)` reports `released: true` and `remaining: Infinity` during a released drag, and the `dnd5e-movement-limiter.constraintReleased` hook fires on a mid-drag release.

## 1.0.0

- First module release, packaging the tested console scripts.
- Drag constraint: limits a token drag to its remaining movement for the active movement action, derived from Foundry's native movement history.
- Extra movement: once an allotment is used up, the next drag starts a new full allotment (configurable cap).
- Combat Tracker buttons: undo/redo one recorded move; Shift+click undoes back to the start of the turn.
- Module settings for GM bypass, out-of-combat and off-turn behavior, extra allotments, thresholds, notifications and debug logging.
