import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Parse "Production Schedule 2026 Current.xlsx" into clean job rows.
//
// The sheet is a free-form layout (not an Excel Table), so we read it as a
// grid and locate columns by header text rather than fixed indices — that way
// it survives Jordan inserting/moving columns. Two data blocks are combined:
// the main MDF/timber section and the in-house fibre-cement section (FC jobs
// get flagged in the project name).
//
// Output row shape:
//   { crm, project, dispatch, committed, actual, lead, priority, fc, overdue }
// ---------------------------------------------------------------------------

const HEADER_HINTS = {
  crm: ["job"],
  project: ["project"],
  committed: ["commited completion", "committed completion", "completion date"],
  actual: ["actual completion"],
  lead: ["lead time"],
  priority: ["priority"],
};

function norm(v) {
  return String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Excel serial or string date -> ISO yyyy-mm-dd (or null).
function toISO(val) {
  if (val == null || val === "") return null;
  if (typeof val === "number") {
    const d = XLSX.SSF.parse_date_code(val);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = String(val).trim();
  // dd/mm/yy or dd/mm/yyyy
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // mm/dd/yyyy (a few rows in the sheet use this US form)
  const d2 = new Date(s);
  if (!isNaN(d2)) {
    return `${d2.getFullYear()}-${String(d2.getMonth() + 1).padStart(2, "0")}-${String(d2.getDate()).padStart(2, "0")}`;
  }
  return null;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const joined = rows[i].map(norm).join(" | ");
    if (joined.includes("job") && joined.includes("project") && joined.includes("lead time")) {
      return i;
    }
  }
  return -1;
}

function mapColumns(headerRow) {
  const idx = {};
  headerRow.forEach((cell, c) => {
    const n = norm(cell);
    for (const [key, hints] of Object.entries(HEADER_HINTS)) {
      if (idx[key] != null) continue;
      if (hints.some((h) => n.includes(h))) idx[key] = c;
    }
  });
  return idx;
}

function crmLooksValid(v) {
  const s = String(v ?? "").trim();
  // e.g. 21222-1, 17630, 17232b-3, 9967-6
  return /^\d{3,6}[a-z]?(-\d+)?$/i.test(s);
}

function parseBlock(rows, startRow, fc) {
  const headerRow = rows[startRow];
  const idx = mapColumns(headerRow);
  if (idx.crm == null || idx.project == null) return [];

  const out = [];
  for (let r = startRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const rawCrm = row[idx.crm];
    // Stop the block at an avg/summary line or a second header.
    const firstCell = norm(rawCrm);
    if (firstCell.startsWith("avg") || firstCell === "job") break;
    if (!crmLooksValid(rawCrm)) continue;

    const project = String(row[idx.project] ?? "").trim();
    if (!project) continue;

    const committed = idx.committed != null ? toISO(row[idx.committed]) : null;
    const actual = idx.actual != null ? toISO(row[idx.actual]) : null;
    const leadRaw = idx.lead != null ? row[idx.lead] : null;
    const lead =
      leadRaw != null && leadRaw !== "" && !isNaN(parseFloat(leadRaw))
        ? Math.round(parseFloat(leadRaw) * 10) / 10
        : null;
    const priority = idx.priority != null ? String(row[idx.priority] ?? "").trim() : "";

    out.push({
      crm: String(rawCrm).trim(),
      project: fc ? `${project} (FC)` : project,
      dispatch: committed,
      committed,
      actual,
      lead,
      priority,
      fc,
    });
  }
  return out;
}

export function parseSchedule(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const jobs = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

    // A sheet can contain both the MDF header and, lower down, the FC header.
    let searchFrom = 0;
    while (searchFrom < rows.length) {
      const hr = findHeaderRow(rows.slice(searchFrom));
      if (hr === -1) break;
      const absHeader = searchFrom + hr;
      // Decide block type by scanning nearby text for "fibre cement".
      const context = rows
        .slice(Math.max(0, absHeader - 2), absHeader + 1)
        .map((r) => r.map(norm).join(" "))
        .join(" ");
      const fc = context.includes("fibre cement") || context.includes("fibre-cement");
      jobs.push(...parseBlock(rows, absHeader, fc));
      searchFrom = absHeader + 1;
    }
  }

  // De-dupe on crm+project (a job can appear once per block); keep first.
  const seen = new Set();
  const clean = [];
  for (const j of jobs) {
    const key = `${j.crm}::${j.project}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Overdue = committed date passed with no actual completion recorded.
    let overdue = false;
    if (j.committed && !j.actual) {
      const d = new Date(j.committed + "T00:00:00");
      overdue = d < today;
    }
    clean.push({ ...j, overdue });
  }

  clean.sort((a, b) => {
    if (!a.dispatch) return 1;
    if (!b.dispatch) return -1;
    return new Date(a.dispatch) - new Date(b.dispatch);
  });

  const leads = clean.filter((j) => j.lead != null).map((j) => j.lead);
  const avgLead = leads.length
    ? Math.round((leads.reduce((s, n) => s + n, 0) / leads.length) * 10) / 10
    : null;

  return { jobs: clean, avgLead };
}
