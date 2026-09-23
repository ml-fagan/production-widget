// The factory, as a set of places a sheet can be.
//
// Until now a location was whatever somebody typed: "on Rack in Warehouse
// area", "Floor near Sample Station in the factory". Fine for the person who
// wrote it, useless to anyone else and impossible to draw.
//
// Five racks, and they are not the same shape as each other. A, B and C are
// addressed bay by bay — a column and a position, "A1-05" — because that's how
// you find one sheet among them. D and E are addressed by zone, "D3", because
// they hold bulk: a zone is three racks wide and two deep and what goes in it
// goes in as a pallet, so a bay-level address there would be precision nobody
// uses and everybody has to maintain.
//
// Free text still reads back: a card that says "near Woodtron" shows as it
// always did, it just isn't on the map until somebody picks a place.

/**
 * The racking, as built.
 *
 * `columns` is how many wide, `depth` how many along. A zoned rack is
 * addressed by its zones instead, and the columns and depth behind it are kept
 * only so the plan can say what a zone actually covers.
 */
export const RACKS = [
  { id: "A", label: "Rack A", columns: 2, depth: 10 },
  { id: "B", label: "Rack B", columns: 2, depth: 9 },
  { id: "C", label: "Rack C", columns: 2, depth: 7 },
  { id: "D", label: "Rack D", columns: 3, depth: 10, zones: 5 },
  { id: "E", label: "Rack E", columns: 2, depth: 10, zones: 5 },
];

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

/** "A1-05" — rack A, column 1, five along. The way it's written on the label. */
export function bayCode(rack, column, position) {
  return `${rack}${column}-${String(position).padStart(2, "0")}`;
}

/** "D3" — rack D, zone 3. A zone is the address; there's nothing inside it. */
export function zoneCode(rack, zone) {
  return `${rack}${zone}`;
}

export function rackOf(code) {
  const id = String(code || "").trim().toUpperCase()[0];
  return RACKS.find((r) => r.id === id) ?? null;
}

/** Every place on the map, racking and floor alike. */
export function allLocations() {
  const list = AREAS.map((a) => a.code);
  for (const rack of RACKS) {
    if (rack.zones) {
      for (let z = 1; z <= rack.zones; z += 1) list.push(zoneCode(rack.id, z));
      continue;
    }
    for (let c = 1; c <= rack.columns; c += 1) {
      for (let p = 1; p <= rack.depth; p += 1) list.push(bayCode(rack.id, c, p));
    }
  }
  return list;
}

const VALID = new Set(allLocations());

/**
 * The code in a location, if there is one.
 *
 * Reads a bare code and one written inside a sentence — somebody typing
 * "A1-05, behind the pallet" is telling us the bay, and losing it over the
 * comma would be pedantry.
 *
 * Also reads the scheme this replaced. The warehouse was numbered 1–5 by aisle
 * with an A/B side ("2-A-07") before the racks were measured and turned out to
 * be four different depths. Aisle 1 is rack A, side A is column 1, and
 * anything past the real depth of a rack — position 12 of a rack that's 9 long
 * — was never a place, so it reads as nowhere rather than as a guess.
 */
export function locationCode(value) {
  const text = String(value ?? "").toUpperCase();

  const bay = text.match(/\b([A-E])\s*([1-3])\s*-\s*(\d{1,2})\b/);
  if (bay) {
    const code = bayCode(bay[1], bay[2], Number(bay[3]));
    if (VALID.has(code)) return code;
  }
  const zone = text.match(/\b([DE])\s*([1-9])\b/);
  if (zone) {
    const code = zoneCode(zone[1], zone[2]);
    if (VALID.has(code)) return code;
  }
  const legacy = text.match(/\b([1-5])\s*-\s*([AB])\s*-\s*(\d{1,2})\b/);
  if (legacy) {
    const rack = RACKS[Number(legacy[1]) - 1];
    const code = rack
      ? rack.zones
        ? zoneCode(rack.id, Math.min(rack.zones, Math.ceil(Number(legacy[3]) / 2)))
        : bayCode(rack.id, legacy[2] === "A" ? 1 : 2, Number(legacy[3]))
      : "";
    if (VALID.has(code)) return code;
  }
  const area = text.match(/\b(FL-0[12]|DSP-01)\b/);
  return area && VALID.has(area[1]) ? area[1] : "";
}

export function isLocationCode(value) {
  return VALID.has(String(value ?? "").trim().toUpperCase());
}

/**
 * How much a place holds, in sheets.
 *
 * Set per section rather than one number for the warehouse, because the
 * sections aren't the same size: a bay on rack C takes what a bay takes, and a
 * zone on rack D is three racks wide and two deep, so it holds several times
 * that. Alice can change any of them from the top of the plan — nobody here
 * knows what a rack holds better than the person loading it.
 */
export const DEFAULT_CAPACITIES = {
  A: 300,
  B: 300,
  C: 300,
  // A zone covers columns × (depth ÷ zones) bays, so it starts at that many
  // bays' worth. A guess, and meant to be corrected once they've been loaded.
  D: 1800,
  E: 1200,
  FLOOR: 300,
};

/** Which capacity a location is measured against. */
export function sectionOf(code) {
  const text = String(code || "").trim().toUpperCase();
  if (AREAS.some((a) => a.code === text)) return "FLOOR";
  return rackOf(text)?.id ?? "FLOOR";
}

export function capacityOf(code, capacities = DEFAULT_CAPACITIES) {
  const section = sectionOf(code);
  const value = Number(capacities?.[section]);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CAPACITIES[section] ?? 300;
}

/**
 * Sheets on a place, whatever mix of materials they are.
 *
 * `here` is how many of that material are on this one, which is not the same
 * as how many we hold: 750 spread across three bays is 300 on this one.
 */
export function bayLoad(rows) {
  return (rows ?? []).reduce((sum, r) => sum + (Number(r.here ?? r.total) || 0), 0);
}

/** empty · holding · full — the three things a place can be at a glance. */
export function bayState(code, rows, capacities) {
  const load = bayLoad(rows);
  if (load <= 0) return "empty";
  return load >= capacityOf(code, capacities) ? "full" : "holding";
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

/**
 * Where the overflow goes.
 *
 * A place holds 300 and there are 750 on it. The answer nobody wants is a red
 * square: they want 300 here, 300 next door, 150 on the one after — which is
 * what somebody would do with the pallet jack anyway, and the plan should say
 * so before they walk it.
 *
 * Fills along the same rack first, from where it already is, before trying the
 * rest of the warehouse. Sheets stay near the sheets they came in with:
 * splitting a pallet across two ends of the building is technically a solution
 * and practically a lost afternoon.
 *
 * `loads` is what every place is already carrying, and `ours` is how much of
 * that is this material — so a place this material is already on offers the
 * room it would have once its own sheets are counted properly, rather than
 * looking full of itself.
 */
export function spreadFrom(code, quantity, loads, ours = new Map(), capacities) {
  const room = (place) => {
    // Never below zero: `ours` is subtracted because this material's own
    // sheets shouldn't count against the room it's offered, and if the two
    // ever disagree the answer must be "no room here", not a place that
    // invents space for itself and swallows the lot.
    const held = Math.max(0, (loads.get(place) ?? 0) - (ours.get(place) ?? 0));
    return Math.max(0, capacityOf(place, capacities) - held);
  };

  const every = allLocations();
  const rack = rackOf(code);
  const sameRack = rack ? every.filter((p) => rackOf(p)?.id === rack.id) : [];
  const from = sameRack.indexOf(code);
  // Along the rack from where we are, then back to its start, then everywhere
  // else — the order somebody would actually walk it.
  const nearby =
    from === -1 ? sameRack : [...sameRack.slice(from), ...sameRack.slice(0, from)];
  const order = [
    code,
    ...nearby.filter((p) => p !== code),
    ...every.filter((p) => p !== code && !nearby.includes(p)),
  ];

  const plan = [];
  let left = Math.max(0, Number(quantity) || 0);
  for (const place of order) {
    if (left <= 0) break;
    const space = room(place);
    if (space <= 0) continue;
    const take = Math.min(space, left);
    plan.push({ bay: place, quantity: take });
    left -= take;
  }
  // If the warehouse genuinely hasn't the room, the last place carries what's
  // left over rather than the sheets quietly vanishing from the plan.
  if (left > 0) {
    if (plan.length === 0) plan.push({ bay: code, quantity: left });
    else plan[plan.length - 1].quantity += left;
  }
  return plan;
}

/** How a location reads written out: "Rack A, column 1, 5 along". */
export function describeLocation(code) {
  const text = String(code || "").trim().toUpperCase();
  const area = AREAS.find((a) => a.code === text);
  if (area) return area.label;
  const rack = rackOf(text);
  if (!rack) return text;
  if (rack.zones) {
    const zone = text.slice(1);
    const deep = Math.round(rack.depth / rack.zones);
    return `Rack ${rack.id}, zone ${zone} — ${rack.columns} wide, ${deep} deep`;
  }
  const parts = text.slice(1).split("-");
  return `Rack ${rack.id}, column ${parts[0]}, ${Number(parts[1])} along`;
}
