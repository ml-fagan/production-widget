/**
 * READ ONLY. Where the production schedule and the "3. Production" Asana
 * project disagree, and why.
 *
 *   node scripts/asana-alignment.mjs
 *
 * Each Asana task's Due date is meant to be the date the job leaves the
 * factory, which is the dispatch date on Duncan's board. This walks every
 * scheduled job (and every load of a split one) through the same
 * `checkAgainstAsana` the handover form uses, and groups what comes back.
 *
 * Reads Firestore through the handover app's own API, exactly as the boards
 * do, and writes nothing anywhere.
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const { fetchProductionTasks, buildAsanaLookup, checkAgainstAsana, extractCrmHandover } =
  await import("../lib/asana.js");
const { fetchLoggedHandovers } = await import("../lib/handovers.js");
const { streamsOf, scheduleFieldFor } = await import("../lib/board.js");

const tasks = await fetchProductionTasks();
const lookup = buildAsanaLookup(tasks);
console.log(`Asana "3. Production": ${tasks.length} tasks, ${lookup.size} job numbers`);

const handovers = await fetchLoggedHandovers();
console.log(`Handovers the feed can see: ${handovers.length}\n`);

/** Every row Duncan's board draws: a job, or one load of a split one. */
const rows = [];
for (const h of handovers) {
  if (h.status === "deleted") continue;
  const streams = streamsOf(h);
  const dispatchOf = (holder) => {
    // The job leaves when the LAST line does, so the later of the two.
    const dates = streams
      .map((s) => {
        const sch = holder?.[scheduleFieldFor(h, s)] || {};
        return sch.actualDate || sch.committedDate || null;
      })
      .filter(Boolean);
    return dates.length ? dates.sort().at(-1) : null;
  };
  const loads = h.despatch ?? [];
  if (loads.length) {
    for (const part of loads) {
      rows.push({
        crm: part.jobId,
        project: h.project || h.client || "",
        dispatch: dispatchOf(part),
        split: `${loads.length} loads`,
        parent: h.jobId,
      });
    }
  } else {
    rows.push({
      crm: h.jobId,
      project: h.project || h.client || "",
      dispatch: dispatchOf(h),
      split: "",
      parent: "",
    });
  }
}

const scheduled = rows.filter((r) => r.dispatch);
console.log(`Rows on the schedule with a date: ${scheduled.length}\n`);

const groups = new Map();
for (const row of scheduled) {
  const result = checkAgainstAsana(row, lookup);
  const key = result.reason;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ ...row, ...result });
}

const order = ["match", "date_mismatch", "ambiguous", "no_match"];
for (const reason of order) {
  const list = groups.get(reason) || [];
  if (!list.length) continue;
  console.log(`\n=== ${reason}  (${list.length}) ===`);
  if (reason === "match") continue;
  for (const r of list.sort((a, b) => String(a.dispatch).localeCompare(String(b.dispatch)))) {
    if (reason === "date_mismatch") {
      const days = Math.round(
        (new Date(`${r.asanaDue}T00:00:00`) - new Date(`${r.dispatch}T00:00:00`)) / 86400000
      );
      console.log(
        `  ${r.crm.padEnd(12)} board ${r.dispatch}  asana ${r.asanaDue || "none"}  ${
          Number.isFinite(days) ? `${days > 0 ? "+" : ""}${days}d` : ""
        }  ${r.split ? `[${r.split}] ` : ""}${r.project}`
      );
      console.log(`               asana task: ${r.taskName}`);
    } else if (reason === "ambiguous") {
      console.log(`  ${r.crm.padEnd(12)} board ${r.dispatch}  ${r.project}`);
      for (const c of r.candidates || []) console.log(`               "${c.name}" due ${c.due || "none"}`);
    }
  }
}

/**
 * Why a row found no task, which is not one answer but four.
 *
 * `candidateKeys` will not fall below CRM+handover, so a task Asana named
 * with the bare CRM — "21366 Emerald State High School" against a board row
 * 21366-1 — is invisible to the check however well the dates agree. That is
 * a different problem from a job nobody has made a task for, and a different
 * one again from a job that went out in September and whose task has since
 * been completed and archived.
 */
const today = new Date().toISOString().slice(0, 10);
/**
 * Tasks named with the BARE job number and nothing after it.
 *
 * Keyed on the whole extracted key being one segment, not on its first
 * segment: "21516-6 Corpus Christi…" is a task for a different handover of
 * job 21516, not a loosely-named task for 21516-2, and counting it as one
 * would turn a missing task into a false match.
 */
const bare = new Map();
for (const t of tasks) {
  const key = extractCrmHandover(t.name);
  if (!key || key.includes("-")) continue;
  if (!bare.has(key)) bare.set(key, []);
  bare.get(key).push(t);
}

const unmatched = groups.get("no_match") || [];
const buckets = { bare: [], past: [], missing: [] };
for (const r of unmatched) {
  const root = String(r.crm).toLowerCase().split("-")[0];
  const onRoot = (bare.get(root) || []).filter((t) => !t.completed);
  if (onRoot.length) buckets.bare.push({ ...r, tasks: onRoot });
  else if (r.dispatch < today) buckets.past.push(r);
  else buckets.missing.push(r);
}

console.log(
  `\n--- why the ${unmatched.length} found nothing ---`
);
console.log(
  `\n  a task exists under the bare job number, which the lookup will not fall back to  (${buckets.bare.length})`
);
for (const r of buckets.bare.sort((a, b) => a.dispatch.localeCompare(b.dispatch))) {
  for (const t of r.tasks) {
    const agree = t.due_on === r.dispatch ? "SAME DATE" : `asana ${t.due_on || "none"}`;
    console.log(`    ${r.crm.padEnd(12)} board ${r.dispatch}  ${agree.padEnd(18)} "${t.name}"`);
  }
}
console.log(`\n  dispatched before today, task presumably completed and gone  (${buckets.past.length})`);
for (const r of buckets.past.sort((a, b) => a.dispatch.localeCompare(b.dispatch))) {
  console.log(`    ${r.crm.padEnd(12)} board ${r.dispatch}  ${r.project}`);
}
console.log(`\n  still to go out, and nothing in Asana answers to it  (${buckets.missing.length})`);
for (const r of buckets.missing.sort((a, b) => a.dispatch.localeCompare(b.dispatch))) {
  console.log(`    ${r.crm.padEnd(12)} board ${r.dispatch}  ${r.project}`);
}

/**
 * The other direction: an Asana task due, with nothing on the board.
 *
 * A row is counted as answering for a task when the task's key is a prefix
 * of the row's job number, the same way `candidateKeys` falls back — a task
 * named 21516-6 is answered by its loads 21516-6-1 and 21516-6-3, which are
 * what Duncan actually dates once a job is split.
 */
const onBoard = rows.map((r) => String(r.crm).toLowerCase());
const answered = (key) =>
  onBoard.some((crm) => crm === key || crm.startsWith(`${key}-`));
const orphans = tasks
  .filter((t) => !t.completed && t.due_on)
  .map((t) => ({ key: extractCrmHandover(t.name), ...t }))
  .filter((t) => t.key && !answered(t.key));
console.log(`\n=== asana tasks with a due date and no row on the board  (${orphans.length}) ===`);
for (const t of orphans.sort((a, b) => a.due_on.localeCompare(b.due_on))) {
  console.log(`  ${String(t.key).padEnd(12)} due ${t.due_on}  ${t.name}`);
}
process.exit(0);
