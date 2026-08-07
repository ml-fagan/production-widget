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

// Asana task names lead with the CRM, handover, and (sometimes) a further
// "-part" suffix, e.g. "21811-1 Fountain College...", "#19966 Ausgrid
// Muswellbrook...", "20488-1 - Alfi Everton Production", or
// "19289-2-1 Woodcrest State College Material Supply..." — tolerant of a "#"
// prefix and of whitespace around each hyphen. Captures every leading
// "-N" segment, since Asana sometimes splits a job as deep as the sheet does.
const CRM_RE = /^#?\s*(\d{3,6}[a-z]?(?:\s*-\s*\d+)*)/i;

export function extractCrmHandover(name) {
  const m = String(name || "").trim().match(CRM_RE);
  if (!m) return null;
  return m[1].replace(/\s*-\s*/g, "-").toLowerCase();
}

// Full CRM(-handover)(-part) -> matching Asana task(s), keyed at whatever
// depth the task name actually specifies. More than one task on the same key
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

// The tracker's crm can go deeper than Asana bothers to split a task (a sheet
// "-part" split within one handover, or a part-of-a-part), so try the most
// specific key first and fall back one segment at a time down to
// CRM+handover — the coarsest level Asana is guaranteed to track at.
function candidateKeys(crm) {
  const segments = String(crm).trim().toLowerCase().split("-").filter(Boolean);
  const floor = Math.min(2, segments.length);
  const keys = [];
  for (let end = segments.length; end >= floor; end--) {
    keys.push(segments.slice(0, end).join("-"));
  }
  return keys;
}

// Kept for compatibility — the CRM+handover-only key, i.e. the coarsest
// candidate `candidateKeys` will ever fall back to.
export function trackerHandoverKey(crm) {
  const keys = candidateKeys(crm);
  return keys[keys.length - 1];
}

export function checkAgainstAsana(job, lookup) {
  for (const key of candidateKeys(job.crm)) {
    const entry = lookup.get(key);
    if (!entry) continue;
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
  return { status: "warn", reason: "no_match" };
}
