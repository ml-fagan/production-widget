// Logged handovers, read from the handover app (decorhandover.lyphex.com).
//
// The handover is the upstream document: Mitch logs one before anything is
// scheduled, so this is where a job first becomes real. The feed uses it for
// two queues — jobs Duncan hasn't scheduled yet, and material Alice hasn't
// ordered yet.

const BASE = process.env.HANDOVER_APP_URL || "";
const SECRET = process.env.JOB_API_SECRET || "";

export async function fetchLoggedHandovers() {
  if (!BASE || !SECRET) throw new Error("Handover app not configured.");
  const res = await fetch(`${BASE.replace(/\/$/, "")}/api/handovers/logged`, {
    headers: { Authorization: `Bearer ${SECRET}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Handover app ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || "Handover app returned an error.");
  return json.handovers || [];
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
