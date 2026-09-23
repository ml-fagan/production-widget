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

/**
 * The id the handover app files a material's placements under.
 *
 * Mirrors `placementKey` there exactly — if these two ever disagree, the page
 * asks for one document and the server writes another, and a material would
 * look as though it had never been put anywhere.
 */
export function placementKeyOf(b) {
  return [
    String(b.name ?? "").trim().toLowerCase(),
    String(dimension(b.length)),
    String(dimension(b.width)),
    String(dimension(b.thickness)),
  ]
    .join("|")
    .replace(/[^a-z0-9|.]+/g, "-")
    .replace(/\|/g, "__")
    .slice(0, 400);
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
 * Folds balances into one box per product, with a row per sheet size.
 *
 * A product is a finish on a substrate at a thickness — the thing you'd order.
 * Its rows are the sizes we hold it in, and the size is the row's name,
 * because that's what somebody walks to a rack for and what Alice buys. The
 * box used to be the finish alone, with substrate and thickness on each row
 * and the size in grey underneath the number: two rows of 6mm Versilux SE both
 * read "— 6mm", and the only thing telling them apart was the smallest text on
 * the card.
 *
 * `available` is the handover app's answer to "what's free" — the same numbers
 * Mitch sees beside his picking list, so the two screens can't disagree about
 * whether a sheet is spoken for. A balance with no matching entry there is
 * treated as fully free rather than assumed reserved: the register showing
 * stock that turns out to be claimed is a conversation, the reverse is an
 * order nobody needed.
 *
 * The product's total counts each claim once. A claim that doesn't say which
 * size it wants lands on every size of that material — deliberately, since
 * nobody knows yet which rack it will come off — so adding the rows up would
 * count it as many times as we hold sizes. That is exactly what made Versilux
 * SE read 264 free when 476 were free. Claim ids come down for this reason.
 */
export function groupByProduct(balances, available = []) {
  const claims = new Map(available.map((m) => [signatureOf(m), m]));
  const groups = new Map();

  for (const b of balances) {
    const { finish, substrate } = splitMaterialName(b.name);
    const thickness = dimension(b.thickness);
    const key = [finish.toLowerCase() || "—", substrate.toLowerCase(), String(thickness)].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        finish: finish || "—",
        substrate,
        thickness,
        rows: [],
        onHand: 0,
        // Claim id → quantity, so the same claim arriving on three rows is
        // still one claim when the box adds itself up.
        claimSeen: new Map(),
      });
    }
    const group = groups.get(key);
    const claim = claims.get(signatureOf(b));
    const reserved = claim ? claim.claimed : 0;
    const rowClaims = claim?.claims ?? [];
    const row = {
      ...b,
      substrate,
      reserved,
      // Never below zero: a job can be down for more than the rack holds, and
      // showing "-3 free" would read as a stock level rather than a shortfall.
      free: Math.max(0, b.total - reserved),
      reservedBy: claim ? claim.claimedBy : [],
      // Per job, with the number, so the row's total adds up in front of you.
      claims: byJob(rowClaims),
      location: [...new Set(b.entries.map((e) => e.location).filter(Boolean))].join(", "),
    };
    group.rows.push(row);
    group.onHand += b.total;
    for (const c of rowClaims) group.claimSeen.set(c.id ?? `${c.jobId}:${c.quantity}`, c.quantity);
  }

  for (const group of groups.values()) {
    // The order you read a rack in: biggest sheet first, since that's the one
    // everything else gets cut from.
    group.rows.sort(
      (a, x) =>
        Number(dimension(x.length) || 0) - Number(dimension(a.length) || 0) ||
        Number(dimension(x.width) || 0) - Number(dimension(a.width) || 0)
    );
    group.reserved = [...group.claimSeen.values()].reduce((sum, q) => sum + q, 0);
    group.free = Math.max(0, group.onHand - group.reserved);
    delete group.claimSeen;
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.finish.localeCompare(b.finish) ||
      String(a.substrate).localeCompare(String(b.substrate)) ||
      Number(a.thickness || 0) - Number(b.thickness || 0)
  );
}

/** Claims folded per job: one line each, however many lines a job wrote. */
function byJob(list) {
  const map = new Map();
  for (const c of list) map.set(c.jobId, (map.get(c.jobId) || 0) + Number(c.quantity || 0));
  return [...map].map(([jobId, quantity]) => ({ jobId, quantity }));
}
