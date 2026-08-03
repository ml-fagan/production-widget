// Cross-check the production schedule against the "3. Production" Asana
// project: each Asana task's Due date is the date the job is scheduled to
// leave the factory, and should line up with the tracker's dispatch date.

const ASANA_PROJECT_GID = "1203879369508803"; // "3. Production"
const TOKEN = process.env.ASANA_TOKEN || "";

async function asanaGet(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Asana GET ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchProductionTasks() {
  if (!TOKEN) throw new Error("Missing ASANA_TOKEN.");
  const tasks = [];
  let url = `https://app.asana.com/api/1.0/tasks?project=${ASANA_PROJECT_GID}&opt_fields=name,due_on,completed&limit=100`;
  while (url) {
    const json = await asanaGet(url);
    tasks.push(...(json.data || []));
    url = json.next_page?.uri || null;
  }
  return tasks;
}

// Asana task names lead with the CRM and handover number, e.g.
// "21811-1 Fountain College...", "#19966 Ausgrid Muswellbrook...",
// "20488-1 - Alfi Everton Production" — tolerant of a "#" prefix and of a
// space where someone typed one instead of a hyphen. Asana has no concept of
// the sheet's third-level "-part" suffix, so we only ever key on CRM+handover.
const CRM_RE = /^#?\s*(\d{3,6}[a-z]?)(?:\s*-\s*(\d+))?/i;

export function extractCrmHandover(name) {
  const m = String(name || "").trim().match(CRM_RE);
  if (!m) return null;
  const crm = m[1].toLowerCase();
  return m[2] ? `${crm}-${m[2]}` : crm;
}

// CRM+handover -> matching Asana task(s). More than one task on the same key
// means we can't tell them apart from the name alone (flagged as ambiguous).
export function buildAsanaLookup(tasks) {
  const map = new Map();
  for (const t of tasks) {
    const key = extractCrmHandover(t.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}

// The tracker's crm can go one level deeper than Asana does (a sheet "-part"
// split within one handover), so only compare the CRM+handover portion.
export function trackerHandoverKey(crm) {
  return String(crm).trim().toLowerCase().split("-").slice(0, 2).join("-");
}

export function checkAgainstAsana(job, lookup) {
  const key = trackerHandoverKey(job.crm);
  const entry = lookup.get(key);
  if (!entry) return { status: "warn", reason: "no_match" };
  if (entry.length > 1) {
    return {
      status: "warn",
      reason: "ambiguous",
      candidates: entry.map((t) => ({ name: t.name, due: t.due_on })),
    };
  }
  const due = entry[0].due_on;
  const ok = !!due && !!job.dispatch && due === job.dispatch;
  return {
    status: ok ? "ok" : "warn",
    reason: ok ? "match" : "date_mismatch",
    asanaDue: due,
    taskName: entry[0].name,
  };
}
