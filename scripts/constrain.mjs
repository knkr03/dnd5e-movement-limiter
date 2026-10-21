/**
 * Remaining-movement drag constraint.
 *
 * Wraps the registered callbacks of each token's MouseInteractionManager
 * (dragLeftStart / dragLeftMove / dragLeftDrop / dragLeftCancel) and clamps
 * interactionData.destination to the token's remaining movement. Foundry's native drag
 * preview, collision and placement still run.
 *
 * Remaining movement is derived from Foundry's own TokenDocument#movementHistory, which
 * Foundry clears at the start of the token's turn and which shrinks when a movement is
 * reverted. There is no custom state to keep in sync.
 */
import { MODULE_ID, setting, log, warn } from "./settings.mjs";

const INSTALLED = Symbol.for(`${MODULE_ID}.installed`);
const UNIT_TO_FEET = { ft: 1, feet: 1, foot: 1, yd: 3, mi: 5280, m: 3.28084, meter: 3.28084, meters: 3.28084, km: 3280.84 };
const UNCONSTRAINED_ACTIONS = new Set(["blink", "displace"]);
const EPSILON = 0.001;

const managers = []; // { manager, callbacks, originals } for clean uninstall

// ------------------------------------------------------------------ units
function sceneFeetFactor() {
  const u = String(canvas.scene?.grid?.units ?? "ft").toLowerCase().trim();
  return UNIT_TO_FEET[u] ?? 1;
}

const measure = (a, b) => canvas.grid.measurePath([a, b]).distance;

// ---------------------------------------------------------- movement budget
const activeAction = (doc) => doc.movementAction || CONFIG.Token?.movement?.defaultAction || "walk";

/** Speed for `action` in scene units. Infinity = unconstrained. */
function speedInSceneUnits(token, action) {
  const movement = token.actor?.system?.attributes?.movement;
  if (!movement) return Infinity; // not a dnd5e-style actor
  if (UNCONSTRAINED_ACTIONS.has(action)) return Infinity;

  const key = (action in movement && typeof movement[action] !== "object") ? action : "walk";
  const value = Number(movement[key]) || 0;
  const unitFactor = UNIT_TO_FEET[String(movement.units ?? "ft").toLowerCase()] ?? 1;
  return (value * unitFactor) / sceneFeetFactor();
}

/**
 * Group the recorded history into movements (one per drag): [{ id, cost, action }].
 * Each waypoint's cost is the cost from the previous waypoint and its movementId
 * identifies the movement it belongs to (the origin waypoint has none).
 */
export function movementGroups(doc) {
  const groups = [];
  let cur = null, prev = null;
  for (const w of doc.movementHistory ?? []) {
    const id = w.movementId ?? null;
    if (id) {
      if (!cur || cur.id !== id) { cur = { id, cost: 0, action: w.action }; groups.push(cur); }
      let seg = 0;
      if (!UNCONSTRAINED_ACTIONS.has(w.action)) {
        const cost = Number(w.cost);
        seg = cost > 0 ? cost : (setting("measureFallback") && prev ? measure(prev, w) : 0);
      }
      cur.cost += seg;
      if (w.action) cur.action = w.action;
    }
    prev = { x: w.x, y: w.y };
  }
  return groups;
}

const extraCap = () => Number(setting("maxExtraAllotments")) || Infinity;

/** Replay history into allotments to find how much of the current one is spent. */
function replay(token) {
  const groups = movementGroups(token.document);
  const threshold = Number(setting("exhaustedThreshold")) || 0;
  const allow = setting("allowExtraMovement");
  let cycleSpent = 0, extras = 0, total = 0;

  for (const g of groups) {
    const sp = speedInSceneUnits(token, g.action || "walk");
    if (allow && isFinite(sp) && cycleSpent > threshold
        && sp - cycleSpent <= threshold && extras < extraCap()) {
      extras++;        // the previous allotment was used up: this movement began a new one
      cycleSpent = 0;
    }
    cycleSpent += g.cost;
    total += g.cost;
  }
  return { cycleSpent, extras, total, moves: groups.length };
}

function isActiveTurn(doc) {
  const combat = game.combat;
  return !!combat?.started && combat.combatant?.tokenId === doc.id;
}

export function budgetFor(token) {
  const doc = token.document;
  const action = activeAction(doc);
  const speed = speedInSceneUnits(token, action);
  const mode = !doc.inCombat ? setting("outOfCombat")
    : isActiveTurn(doc) ? "turn"
    : setting("offTurn");

  const base = { speed, action, mode, spent: 0, extras: 0, moves: 0, newAllotment: false };
  if (!isFinite(speed) || mode === "none") return { ...base, remaining: Infinity };
  if (mode === "full") return { ...base, remaining: speed };

  const h = replay(token);
  const threshold = Number(setting("exhaustedThreshold")) || 0;
  const remaining = Math.max(0, speed - h.cycleSpent);
  const out = { ...base, spent: h.cycleSpent, extras: h.extras, moves: h.moves };

  // Only when the allotment is used up does the next drag begin a fresh one.
  if (setting("allowExtraMovement") && h.cycleSpent > threshold
      && remaining <= threshold && h.extras < extraCap()) {
    return { ...out, remaining: speed, newAllotment: true };
  }
  return { ...out, remaining };
}

// --------------------------------------------------------------- clamping
/** Farthest point on the origin->point line within `budget` scene units. */
function clampToBudget(origin, point, budget) {
  if (!isFinite(budget)) return point;
  if (measure(origin, point) <= budget + EPSILON) return point;

  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const p = { x: origin.x + (point.x - origin.x) * mid, y: origin.y + (point.y - origin.y) * mid };
    if (measure(origin, p) <= budget) lo = mid; else hi = mid;
  }
  return {
    ...point,
    x: origin.x + (point.x - origin.x) * lo,
    y: origin.y + (point.y - origin.y) * lo
  };
}

function applyClamp(event, drag) {
  const dest = event?.interactionData?.destination;
  if (!dest || !drag) return null;
  const clamped = clampToBudget(drag.origin, dest, drag.budget.remaining);
  if (clamped.x !== dest.x || clamped.y !== dest.y) {
    dest.x = clamped.x;
    dest.y = clamped.y;
  }
  return clamped;
}

// ----------------------------------------------------------- installation
export function installOnToken(token) {
  const manager = token?.mouseInteractionManager;
  const callbacks = manager?.callbacks;
  if (!callbacks || manager[INSTALLED]) return;

  const originals = {};
  let drag = null;

  const wrap = (name, fn) => {
    if (typeof callbacks[name] !== "function") return warn(`Missing interaction callback: ${name}`);
    originals[name] = callbacks[name];
    callbacks[name] = function (event, ...args) { return fn(originals[name], this, event, args); };
  };

  wrap("dragLeftStart", (orig, self, event, args) => {
    drag = null;
    const bypass = game.user.isGM && setting("gmBypass");
    if (!bypass && token.document.isOwner) {
      // Never let a failure here block Foundry's native drag initialization.
      try {
        const budget = budgetFor(token);
        drag = { origin: { x: token.center.x, y: token.center.y }, budget };
        log(`Drag start: ${token.name}`, {
          action: budget.action, mode: budget.mode, speed: budget.speed,
          spent: budget.spent, remaining: budget.remaining,
          moves: budget.moves, extraAllotments: budget.extras, newAllotment: budget.newAllotment
        });
      } catch (err) {
        drag = null;
        warn("Budget calculation failed; drag left unconstrained.", err);
      }
    }
    return orig.call(self, event, ...args);
  });

  wrap("dragLeftMove", (orig, self, event, args) => {
    applyClamp(event, drag);
    return orig.call(self, event, ...args);
  });

  wrap("dragLeftDrop", (orig, self, event, args) => {
    let granted = null;
    if (drag) {
      const raw = { ...event.interactionData?.destination };
      const clamped = applyClamp(event, drag);
      if (clamped) {
        const dist = measure(drag.origin, clamped);
        log("Drop", { raw, clamped, distance: dist, remaining: drag.budget.remaining });
        if (drag.budget.newAllotment && dist > EPSILON) granted = drag.budget.extras + 1;
      }
    }
    const result = orig.call(self, event, ...args);
    if (granted && setting("notify")) {
      ui.notifications.info(game.i18n.format("MOVELIMIT.ExtraGranted", { name: token.name, n: granted }));
    }
    drag = null;
    return result;
  });

  wrap("dragLeftCancel", (orig, self, event, args) => {
    drag = null;
    return orig.call(self, event, ...args);
  });

  manager[INSTALLED] = true;
  managers.push({ manager, callbacks, originals });
}

export function installOnAllTokens() {
  for (const token of canvas.tokens?.placeables ?? []) installOnToken(token);
}

export function uninstallConstraint() {
  for (const { manager, callbacks, originals } of managers) {
    for (const [name, fn] of Object.entries(originals)) callbacks[name] = fn;
    delete manager[INSTALLED];
  }
  managers.length = 0;
}

export function registerConstraintHooks() {
  Hooks.on("refreshToken", (token) => installOnToken(token));
  Hooks.on("canvasReady", () => installOnAllTokens());
}

/** Public API pieces (exposed on game.modules.get(id).api). */
export const constraintApi = {
  status: (token) => (token ? budgetFor(token) : null),
  history: (token) => (token ? movementGroups(token.document) : null),
  resetTurn: (token) => token?.document?.clearMovementHistory?.()
};
