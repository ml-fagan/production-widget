// Alice's register, arranged the way she looks for something.
//
// Nobody walks out to the racks thinking "2400×1200×12"; they think "have we
// got any Blackbutt?" and then which board and how thick. So the register
// groups by finish first, and everything under one finish — every substrate,
// every thickness — lives in that finish's box.
//
// One flat list of every size we hold was a page of near-identical rows with
// the useful distinction buried in the middle of each one.

/**
 * A size, as the number it is.
 *
 * "12", "12mm", " 12 mm" are one thickness, and the register buckets by size —
 * so a card entered as "9mm" could never merge with one entered as "9", and
 * the page, which appends its own "mm", printed it as "9mmmm". Written as
 * numbers from now on; this is what makes the ones already stored line up.
 */
export function dimension(value) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? value : "";
  const found = String(value).match(/-?\d+(?:\.\d+)?/);
  return found ? Number(found[0]) : String(value).trim();
}

/** "Smartlook Blackbutt on FR MDF" → { finish, substrate }. */
export function splitMaterialName(name) {
  const at = String(name || "").toLowerCase().indexOf(" on ");
  if (at === -1) return { finish: String(name || "").trim(), substrate: "" };
  return {
    finish: String(name).slice(0, at).trim(),
    substrate: String(name).slice(at + 4).trim(),
  };
}

/** The key two rows must share to be the same material. Mirrors the ledger's. */
export function signatureOf(b) {
  return [
    String(b.name || "").trim().toLowerCase(),
    String(dimension(b.length)),
    String(dimension(b.width)),
    String(dimension(b.thickness)),
  ].join("|");
}

/**
 * Folds balances into finish → rows, merging in what each row has reserved.
 *
 * `available` is the handover app's answer to "what's free" — the same numbers
 * Mitch sees beside his picking list, so the two screens can't disagree about
 * whether a sheet is spoken for. A balance with no matching entry there is
 * treated as fully free rather than assumed reserved: the register showing
 * stock that turns out to be claimed is a conversation, the reverse is an
 * order nobody needed.
 *
 * Rows sort by substrate then thickness, which is the order someone reads a
 * rack in. Finishes sort by name, with the unclaimed ones first only in the
 * sense that the finish total tells you whether it's worth walking over.
 */
export function groupByFinish(balances, available = []) {
  const claims = new Map(available.map((m) => [signatureOf(m), m]));
  const groups = new Map();

  for (const b of balances) {
    const { finish, substrate } = splitMaterialName(b.name);
    const key = finish.toLowerCase() || "—";
    if (!groups.has(key)) {
      groups.set(key, { finish: finish || "—", rows: [], onHand: 0, reserved: 0 });
    }
    const group = groups.get(key);
    const claim = claims.get(signatureOf(b));
    const reserved = claim ? claim.claimed : 0;
    const row = {
      ...b,
      substrate,
      reserved,
      // Never below zero: a job can be down for more than the rack holds, and
      // showing "-3 free" would read as a stock level rather than a shortfall.
      free: Math.max(0, b.total - reserved),
      reservedBy: claim ? claim.claimedBy : [],
      location: [...new Set(b.entries.map((e) => e.location).filter(Boolean))].join(", "),
    };
    group.rows.push(row);
    group.onHand += b.total;
    group.reserved += reserved;
  }

  for (const group of groups.values()) {
    group.rows.sort(
      (a, x) =>
        String(a.substrate).localeCompare(String(x.substrate)) ||
        Number(a.thickness || 0) - Number(x.thickness || 0)
    );
    group.free = Math.max(0, group.onHand - group.reserved);
  }

  return [...groups.values()].sort((a, b) => a.finish.localeCompare(b.finish));
}
