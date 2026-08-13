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

// A handover counts as scheduled once the spreadsheet has a row for it, or for
// any part beneath it — the schedule keys deeper than the handover does
// (handover 19289-2 shows up as rows 19289-2-1 and 19289-2-2).
export function isScheduled(handover, scheduleCrms) {
  const id = String(handover.jobId).trim().toLowerCase();
  for (const crm of scheduleCrms) {
    if (crm === id || crm.startsWith(`${id}-`)) return true;
  }
  return false;
}

export function splitByScheduled(handovers, jobs) {
  const scheduleCrms = jobs.map((j) => String(j.crm).trim().toLowerCase());
  const awaiting = [];
  const scheduled = [];
  for (const h of handovers) {
    (isScheduled(h, scheduleCrms) ? scheduled : awaiting).push(h);
  }
  return { awaiting, scheduled };
}
