// Logged handovers, read from the handover app (decorhandover.lyphex.com).
//
// The handover is the upstream document: Mitch logs one before anything is
// scheduled, so this is where a job first becomes real. The feed uses it for
// two queues — jobs Duncan hasn't scheduled yet, and material Alice hasn't
// ordered yet.

const BASE = process.env.HANDOVER_APP_URL || "";
const SECRET = process.env.JOB_API_SECRET || "";

/**
 * The jobs, held between requests and topped up rather than refetched.
 *
 * Five boards read this list, every one of them on a timer, and Firestore
 * bills a document per document returned — so the old shape paid for every
 * live job, several times over, every few minutes, to be told almost nothing
 * had changed. Measured: about 124,000 reads a day for six people with boards
 * open.
 *
 * So the set is kept here, on the instance, and each refresh asks only what
 * moved since the last one. A quiet poll costs three reads instead of three
 * hundred.
 *
 * The rule this is built around: a job Mitch has handed over must reach
 * Alice. Of the ways a cache can be wrong, showing something stale for a
 * minute is survivable and losing a row is not — a picking list nobody can
 * see is indistinguishable from material nobody asked for, and the first
 * anybody knows is the job being short. So every path out of here falls back
 * to reading everything:
 *
 *   • the server returns `total`, and a merge that doesn't match it is thrown
 *     away and refetched;
 *   • the whole set is reread every few minutes regardless, so anything that
 *     slipped past the check heals on its own;
 *   • any error at all drops the snapshot rather than serving what is left.
 */
let snapshot = null;

/** However quiet it is, start again this often. */
const FULL_REREAD_MS = 5 * 60 * 1000;
/** Don't ask again more often than the boards could notice. */
const MIN_GAP_MS = 10 * 1000;

async function ask(path) {
  if (!BASE || !SECRET) throw new Error("Handover app not configured.");
  const res = await fetch(`${BASE.replace(/\/$/, "")}${path}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Handover app ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Handover app returned an error.");
  return json;
}

async function readEverything() {
  const json = await ask("/api/handovers/logged");
  const rows = json.handovers || [];
  snapshot = {
    byId: new Map(rows.map((h) => [h.jobId, h])),
    // Firestore's clock, not ours — see `cursorFrom` in the logged route.
    cursor: json.cursor || "1970-01-01T00:00:00.000Z",
    fullAt: Date.now(),
    lastAt: Date.now(),
  };
  return rows;
}

export async function fetchLoggedHandovers() {
  const now = Date.now();
  if (!snapshot || now - snapshot.fullAt > FULL_REREAD_MS) return readEverything();
  if (now - snapshot.lastAt < MIN_GAP_MS) return [...snapshot.byId.values()];

  try {
    const json = await ask(`/api/handovers/logged?since=${encodeURIComponent(snapshot.cursor)}`);
    // An older build of the handover app doesn't know about `since` and will
    // have answered with the whole list. Take it and carry on.
    if (!json.delta) return readEverything();

    const byId = new Map(snapshot.byId);
    for (const row of json.changed || []) byId.set(row.jobId, row);
    for (const id of json.droppedIds || []) byId.delete(id);

    // The integrity check. If what we hold isn't the size the server says the
    // answer is, something was missed, and the only safe response is to stop
    // guessing and read it all.
    if (typeof json.total === "number" && byId.size !== json.total) {
      return readEverything();
    }

    snapshot = {
      byId,
      cursor: json.cursor || snapshot.cursor,
      fullAt: snapshot.fullAt,
      lastAt: now,
    };
    return [...byId.values()];
  } catch (err) {
    // Never serve a half-merged set. Drop it and read everything.
    snapshot = null;
    throw err;
  }
}

/**
 * A handover counts as scheduled once Duncan has committed it to a date.
 *
 * It used to mean "Jordan's spreadsheet has a row for it", which was right
 * while the sheet was how a job got scheduled — the test even allowed for the
 * sheet keying deeper than the handover does, 19289-2 appearing as rows
 * 19289-2-1 and 19289-2-2.
 *
 * The floor has stopped using the sheet, and a committed date is the thing
 * that actually made a job scheduled all along: the sheet was where that date
 * was written down, not what made it true. Reading it off the record removes
 * the gap where a job was dated on the board and still sat in the "awaiting a
 * date" queue until somebody retyped it into a spreadsheet.
 */
export function isScheduled(handover) {
  return Boolean(String(handover?.schedule?.committedDate ?? "").trim());
}

export function splitByScheduled(handovers) {
  const awaiting = [];
  const scheduled = [];
  for (const h of handovers) {
    (isScheduled(h) ? scheduled : awaiting).push(h);
  }
  return { awaiting, scheduled };
}
