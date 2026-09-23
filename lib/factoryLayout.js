// The factory, as a set of places a sheet can be.
//
// Until now a location was whatever somebody typed: "on Rack in Warehouse
// area", "Floor near Sample Station in the factory". Fine for the person who
// wrote it, useless to anyone else and impossible to draw. This is the scheme
// off the floor plan — five aisles, two sides, fifteen positions — plus the
// floor stock areas and the dispatch end.
//
// Free text still reads back: a card that says "near Woodtron" shows as it
// always did, it just isn't on the map until somebody puts it on a bay.

export const AISLES = [1, 2, 3, 4, 5];
export const SIDES = ["A", "B"];
export const POSITIONS = 15;

/**
 * Floor stock and the dispatch end — places material sits that aren't racking.
 *
 * They're on the map because they're where material actually is: the CNC floor
 * and the assembly floor hold sheets for days at a time, and dispatch holds
 * what's about to leave.
 */
export const AREAS = [
  { code: "FL-01", label: "CNC floor stock", where: "production" },
  { code: "FL-02", label: "Assembly floor stock", where: "production" },
  { code: "DSP-01", label: "Dispatch / loading", where: "front" },
];

/**
 * The plan, as blocks. Not to scale and not meant to be — it's for finding a
 * rack, so what matters is that the things next to each other on the floor are
 * next to each other here.
 */
export const PRODUCTION_BLOCKS = [
  [
    { name: "CNC 1536B+", note: "Installed" },
    { name: "CNC 1536B+", note: "Installed" },
  ],
  [{ area: "FL-01" }, { name: "CNC 1536B" }],
  [{ name: "Offices & amenities", note: "Office end", tall: true }, { name: "CNC 1236S" }],
  [{ name: "Machining", note: "Table saw" }, { name: "Moulder" }],
  [{ name: "Drop saw / compressor" }, { name: "Edge bander" }],
  [{ name: "Vitap" }, { name: "Work station" }],
  [{ area: "FL-02" }, { name: "Decorsorb" }],
  [{ name: "Assembly" }, { name: "Sander" }],
  [{ name: "CNC" }, { name: "Drop saw" }],
];

/**
 * How much a bay holds, in sheets.
 *
 * One number for every bay, which is not true — a rack takes what it takes,
 * depending on what's on it and how thick that is. It's a working figure so
 * the plan can say "this one's full" instead of only "this one has something
 * on it", and so somebody placing a pallet can see where there's room. Expect
 * to change it once the racks have been walked.
 *
 * A bay holds as many materials as it needs to: 280 of one board and 20 of
 * the next is one bay at 300, and the twenty that wouldn't fit go on the one
 * beside it. Nothing here stops her going over — a rack that's genuinely
 * over-stacked is a fact, and a register that refuses to record it is just a
 * register that's wrong.
 */
export const BAY_CAPACITY = 300;

/** Bays that aren't the standard size. Empty until somebody measures them. */
export const CAPACITY_OVERRIDES = {};

export function capacityOf(code) {
  return CAPACITY_OVERRIDES[code] ?? BAY_CAPACITY;
}

/**
 * Sheets on a bay, whatever mix of materials they are.
 *
 * `here` is how many of that material are on this bay, which is not the same
 * as how many we hold: 750 spread across three racks is 300 on this one.
 */
export function bayLoad(rows) {
  return (rows ?? []).reduce(
    (sum, r) => sum + (Number(r.here ?? r.total) || 0),
    0
  );
}

/** empty · holding · full — the three things a bay can be at a glance. */
export function bayState(code, rows) {
  const load = bayLoad(rows);
  if (load <= 0) return "empty";
  return load >= capacityOf(code) ? "full" : "holding";
}

/**
 * Light green free, orange with something on it, red full.
 *
 * Deliberately not a gradient: from across the warehouse on a phone the
 * question is which racks to walk to, and three answers is all that carries.
 */
export const BAY_COLOURS = {
  empty: { bg: "#eaf1e7", border: "#c3d6bd", ink: "#4a6b46" },
  holding: { bg: "#fae3c0", border: "#e0b877", ink: "#7a5310" },
  full: { bg: "#f6cfcd", border: "#dd9d9a", ink: "#8c2f2b" },
};

/** "2-A-07" — the way it's written on the rack label. */
export function bayCode(aisle, side, position) {
  return `${aisle}-${side}-${String(position).padStart(2, "0")}`;
}

/** Every place on the map, racking and floor alike. */
export function allLocations() {
  const list = AREAS.map((a) => a.code);
  for (const aisle of AISLES) {
    for (const side of SIDES) {
      for (let p = 1; p <= POSITIONS; p += 1) list.push(bayCode(aisle, side, p));
    }
  }
  return list;
}

const VALID = new Set(allLocations());

/**
 * The code in a location, if there is one.
 *
 * Reads a bare code, and also finds one written inside a sentence — somebody
 * typing "2-A-07, behind the pallet" is telling us the bay, and losing it over
 * the comma would be pedantry. Anything with no code in it returns "", which
 * is how free text stays free text.
 */
export function locationCode(value) {
  const text = String(value ?? "").toUpperCase();
  const bay = text.match(/\b([1-5])\s*-\s*([AB])\s*-\s*(\d{1,2})\b/);
  if (bay) {
    const code = bayCode(bay[1], bay[2], Number(bay[3]));
    if (VALID.has(code)) return code;
  }
  const area = text.match(/\b(FL-0[12]|DSP-01)\b/);
  return area && VALID.has(area[1]) ? area[1] : "";
}

export function isLocationCode(value) {
  return VALID.has(String(value ?? "").trim().toUpperCase());
}

/** What each location is holding, keyed by code, from the register's rows. */
export function stockByLocation(rows) {
  const map = new Map();
  for (const row of rows) {
    const code = locationCode(row.location);
    if (!code) continue;
    if (!map.has(code)) map.set(code, []);
    map.get(code).push(row);
  }
  return map;
}

/**
 * Where the overflow goes.
 *
 * A bay holds 300 and there are 750 on it. The answer nobody wants is a red
 * square: they want 300 here, 300 next door, 150 on the one after — which is
 * what somebody would do with the pallet jack anyway, and the plan should say
 * so before they walk it.
 *
 * Fills along the aisle from the bay itself, using whatever room each one has,
 * before trying the rest of the warehouse. Sheets stay near the sheets they
 * came in with: splitting a pallet across two ends of the building is
 * technically a solution and practically a lost afternoon.
 *
 * `loads` is what every bay is already carrying, and `ours` is how much of
 * that is this material — so a bay this material is already on offers the room
 * it would have once its own sheets are counted properly, rather than looking
 * full of itself.
 */
export function spreadFrom(code, quantity, loads, ours = new Map()) {
  const room = (bay) => {
    // Never below zero: `ours` is subtracted because this material's own
    // sheets shouldn't count against the room it's offered, and if the two
    // ever disagree the answer must be "no room here", not a bay that invents
    // space for itself and swallows the lot.
    const held = Math.max(0, (loads.get(bay) ?? 0) - (ours.get(bay) ?? 0));
    return Math.max(0, capacityOf(bay) - held);
  };

  const parts = String(code || "").split("-");
  const inAisle = [];
  if (parts.length === 3) {
    const [aisle, side] = parts;
    const start = Number(parts[2]);
    for (let p = start; p <= POSITIONS; p += 1) inAisle.push(bayCode(aisle, side, p));
    for (let p = start - 1; p >= 1; p -= 1) inAisle.push(bayCode(aisle, side, p));
  }
  const order = [code, ...inAisle.filter((b) => b !== code), ...allLocations().filter(
    (b) => b !== code && !inAisle.includes(b)
  )];

  const plan = [];
  let left = Math.max(0, Number(quantity) || 0);
  for (const bay of order) {
    if (left <= 0) break;
    const space = room(bay);
    if (space <= 0) continue;
    const take = Math.min(space, left);
    plan.push({ bay, quantity: take });
    left -= take;
  }
  // If the warehouse genuinely hasn't the room, the last bay carries what's
  // left over rather than the sheets quietly vanishing from the plan.
  if (left > 0) {
    if (plan.length === 0) plan.push({ bay: code, quantity: left });
    else plan[plan.length - 1].quantity += left;
  }
  return plan;
}

/** How a location reads when it's written out: "Aisle 2, side A, position 07". */
export function describeLocation(code) {
  const area = AREAS.find((a) => a.code === code);
  if (area) return area.label;
  const parts = String(code || "").split("-");
  if (parts.length !== 3) return code || "";
  return `Aisle ${parts[0]}, side ${parts[1]}, position ${parts[2]}`;
}
