/**
 * The drafting register, as the board reads it.
 *
 * Every number here is worked out at read time from the cached fields. None of
 * them is stored: a day count written down is wrong by the next morning, and
 * the whole point of the board is the day count.
 *
 * The handover app keeps the same rules — one copy each side, like the shelf
 * orders and the access areas, rather than one shared file neither app can
 * deploy without the other.
 */

/** Brisbane is UTC+10 and never moves. */
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

/**
 * The Brisbane calendar day an instant falls on.
 *
 * Asana returns UTC, and an evening-UTC timestamp is already tomorrow here.
 * Counting elapsed hours and dividing would put every row out by one around
 * midnight — the unit on this board is whole days, so the comparison has to be
 * between calendar days rather than instants.
 */
export function brisbaneDay(at) {
  if (!at) return "";
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return new Date(when.getTime() + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today, in Brisbane. */
export function today() {
  return brisbaneDay(new Date());
}

/** Whole days between two calendar days. Both read as UTC midnight, so exact. */
export function daysBetweenDays(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000
  );
}

/**
 * The day the clock runs from, and which event it was.
 *
 * The LATER of the last issue and the last recorded chase — not the chase by
 * preference, which is what this did at first and was wrong.
 *
 * Asana's Follow Up field is not maintained. Nobody updates it when they touch
 * base, so it sits at whatever it was last set to, and reading it as "last
 * contact" made a reissue that happened afterwards invisible. 20878 went out
 * again on 28 September and read as forty-five days quiet, off a chase from
 * 18 August; three of the forty-one rows were wrong this way.
 *
 * A chase still wins when it is genuinely the more recent of the two, which is
 * the case the Chased button exists for — and a chase recorded through the
 * board is reliable precisely because pressing the button is what sets it.
 *
 * `completedAt` rather than `modifiedAt`, and the difference matters: both
 * usually agree, because ticking a task complete is often the last thing done
 * to it. They part when somebody edits the task afterwards — a product tag, an
 * assignee — and `modifiedAt` jumps while nothing happened with the client.
 * That failure is silent and runs one way only: a stale job looks fresh.
 */
export function clockFrom(row) {
  /**
   * Whichever real thing happened last.
   *
   * Both boards count from the most recent event on the task, and a comment
   * counts on both. "Called and left a message." on Devonport is contact by
   * any sane reading, and the board was calling that set twenty-four days
   * quiet because the comment was not one of the dates it looked at.
   *
   * Accounts have no issue date — nothing in that project is ever completed —
   * and their Follow Up field is deliberately not a candidate: there it holds
   * a date to chase ON, in the future, which Veronica keeps up on sixty-nine
   * of the ninety-five. Treating that as contact would read next Tuesday's
   * reminder as something that had already happened.
   *
   * Ties go to the earlier candidate, so a set issued and commented on the
   * same day reads as issued. The count is identical either way; this only
   * decides which word the row uses to explain itself.
   */
  const candidates =
    row.kind === "accounts"
      ? [
          // Never commented on at all — count from when the account was raised.
          { day: brisbaneDay(row.createdAt), basis: "opened" },
          { day: brisbaneDay(row.lastContactAt), basis: "contacted" },
        ]
      : [
          { day: brisbaneDay(row.completedAt), basis: "issued" },
          { day: row.followUpAt || "", basis: "chased" },
          { day: brisbaneDay(row.lastContactAt), basis: "contacted" },
        ];

  let best = { day: "", basis: "none" };
  for (const candidate of candidates) {
    if (!candidate.day) continue;
    if (!best.day || candidate.day > best.day) best = candidate;
  }
  return best;
}

/**
 * The last chase that still counts.
 *
 * A chase from before the current issue has been overtaken by it: the drawings
 * went out again afterwards, so nobody has chased THIS set. Empty rather than
 * stale, so "never chased" means what it says.
 */
export function chasedSinceIssue(row) {
  // Worked out on its own rather than read off clockFrom's winner. Once a
  // comment can win the clock, a set chased last week but commented on
  // yesterday would come back "never chased", which is simply untrue.
  if (isAccount(row)) return "";
  const chased = row.followUpAt || "";
  if (!chased) return "";
  const issued = brisbaneDay(row.completedAt);
  if (!issued) return chased;
  return chased > issued ? chased : "";
}

/** Accounts carry a contact date; drawings carry a chase. */
export function isAccount(row) {
  return row.kind === "accounts";
}

/**
 * What counts as the same job, for tying two rows together.
 *
 * The tracker parent first, because that is the company's own answer: a
 * drawing set and Veronica's account are usually two subtasks of one job in
 * All Jobs - Tracker, alongside Production and Material. The CRM second, for
 * the rows with no parent. The task gid last, so a row with neither is tied
 * only to itself.
 *
 * Deliberately NOT the base of the number: 18359 and 18359-1 are different
 * portions of Hallam, as are 20038/20038-1 and the two ING deliveries.
 */
export function jobKeyOf(row) {
  if (row.jobGid) return `job:${row.jobGid}`;
  if (row.crm) return `crm:${row.crm}`;
  return `task:${row.taskGid}`;
}

/**
 * The other rows on this job.
 *
 * Shown rather than hidden. Hiding the older of two rows was the obvious
 * thing and the data said otherwise: the two rows are different stages with
 * different people on them, so recent activity on one says nothing about the
 * other. Townsville's drawings were commented on four days ago while its
 * account had not been touched in eighty-eight — folding them together would
 * have buried the half that needed the work.
 */
export function siblingsOf(row, rows) {
  const key = jobKeyOf(row);
  return rows.filter((r) => r.taskGid !== row.taskGid && jobKeyOf(r) === key);
}

/**
 * An index of taskGid → the rows sharing its job, built once per render.
 *
 * Two passes, because a job's rows don't all reach it the same way. ING has
 * its "Delivery 1" account as a subtask of the job and its main account
 * sitting loose, so one keys on the parent and the other on the number, and a
 * single pass would file them apart. The second pass folds a parentless row
 * into the parent's group when its number points at exactly one job —
 * "exactly one", or two portions under different parents would be merged on a
 * number they merely share.
 */
export function groupByJob(rows) {
  const byKey = new Map();
  for (const r of rows) {
    const key = jobKeyOf(r);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }

  // Which job does a CRM point at? Only answered when it points at one.
  const crmToJob = new Map();
  for (const r of rows) {
    if (!r.jobGid || !r.crm) continue;
    const seen = crmToJob.get(r.crm);
    if (seen === undefined) crmToJob.set(r.crm, `job:${r.jobGid}`);
    else if (seen !== `job:${r.jobGid}`) crmToJob.set(r.crm, null); // ambiguous
  }

  const keyFor = (r) => {
    if (r.jobGid) return `job:${r.jobGid}`;
    const viaCrm = r.crm ? crmToJob.get(r.crm) : null;
    return viaCrm || jobKeyOf(r);
  };

  const groups = new Map();
  for (const r of rows) {
    const key = keyFor(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const byTask = new Map();
  for (const group of groups.values()) {
    for (const r of group) byTask.set(r.taskGid, group);
  }
  return byTask;
}

/**
 * Nobody has been in touch since.
 *
 * Asked of the clock rather than of one field, so it means the same thing on
 * both boards however the contact was recorded: if the newest thing that
 * happened is still the issue, or the day the account was raised, then nobody
 * has chased it and nobody has commented on it.
 */
export function neverContacted(row) {
  const { basis } = clockFrom(row);
  return basis !== "chased" && basis !== "contacted";
}

/** How long nobody has done anything about this job. */
export function quietDays(row, now = today()) {
  const { day } = clockFrom(row);
  if (!day) return null;
  return daysBetweenDays(day, now);
}

export const BANDS = [
  {
    key: "aged",
    label: "Quiet for four weeks or more",
    hint: "Nobody has touched these",
    urgent: true,
  },
  { key: "watch", label: "Two to four weeks", hint: "" },
  { key: "fresh", label: "Recently out", hint: "" },
];

/**
 * Which band a row falls in.
 *
 * Bands rather than one long sort, because a sort can't say why. These put the
 * rows that matter today at the top, under a heading that names the reason.
 *
 * Four weeks, not a month. It was "over thirty days" and the Overview counted
 * from twenty-eight, so the same screen gave two numbers for what any reader
 * would take to be one thing — thirty-eight here against forty-three there,
 * the five rows in between. Weeks throughout now, since that is how chasing is
 * actually talked about.
 */
export function bandOf(days) {
  if (days === null || days === undefined) return "fresh";
  if (days >= 28) return "aged";
  if (days >= 14) return "watch";
  return "fresh";
}

/** "3rd · from 12 Jun" — how many times it has gone out, once it's been more than once. */
export function timesOutLabel(row) {
  const n = Number(row.timesOut);
  if (!n || n <= 1) return { text: "1st", repeat: false };
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st"
    : n % 10 === 2 && n % 100 !== 12 ? "nd"
      : n % 10 === 3 && n % 100 !== 13 ? "rd"
        : "th";
  const from = row.firstOutAt ? shortDay(brisbaneDay(row.firstOutAt)) : "";
  return { text: from ? `${n}${suffix} · from ${from}` : `${n}${suffix}`, repeat: true };
}

/** "12 Jun" */
export function shortDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return "";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
  });
}

/**
 * The filters across the top.
 *
 * Built from the rows rather than hard-coded, so a new drafter appears the day
 * they're assigned something instead of the day somebody edits this file.
 */
export function pillsFor(rows, now = today()) {
  const people = [...new Set(rows.map((r) => r.assignee).filter(Boolean))].sort();
  return [
    // Not a filter but a view: the board totalled rather than listed. First,
    // because "how are we doing" is asked before "which one next".
    { key: "overview", label: "Overview", count: null },
    { key: "all", label: "Everything", count: rows.length },
    { key: "kind:drawings", label: "Drawings", count: rows.filter((r) => !isAccount(r)).length },
    { key: "kind:accounts", label: "Accounts", count: rows.filter(isAccount).length },
    {
      // Not chased SINCE the current issue, or never commented on at all.
      // A chase from before the drawings went out again hasn't chased this
      // set, and counting it would hide the row from the one filter meant to
      // catch it.
      key: "never",
      // "Touched" rather than "chased": a comment counts now, so the filter
      // means nobody has chased it AND nobody has written on it.
      label: "Never touched",
      count: rows.filter(neverContacted).length,
    },
    {
      key: "reissued",
      label: "Reissued",
      count: rows.filter((r) => Number(r.timesOut) > 1).length,
    },
    ...people.map((name) => ({
      key: `who:${name}`,
      label: name.split(" ")[0],
      count: rows.filter((r) => r.assignee === name).length,
    })),
  ].filter((p) => p.count > 0 || p.key === "all" || p.key === "overview");
}

/**
 * How overdue a chase is, in weeks.
 *
 * An ordinal scale, not a set of categories: swapping the order would change
 * the meaning, so the colour is one hue getting darker rather than four
 * unrelated hues. Validated as a ramp — monotone lightness, a single hue, and
 * the palest step still 2.1:1 on white.
 *
 * "Under 2 weeks" is deliberately a neutral and not the palest amber. It means
 * there is nothing to chase, which is a different thing from being a bit late,
 * and a pale amber would have read as the start of the same scale.
 */
export const CHASE_BANDS = [
  { key: "fresh", label: "Under 2 weeks", from: 0, color: "#b7af9c" },
  { key: "w2", label: "2 to 3 weeks", from: 14, color: "#e3a857" },
  { key: "w3", label: "3 to 4 weeks", from: 21, color: "#c07f1f" },
  { key: "w4", label: "4 weeks or more", from: 28, color: "#8a4f08" },
];

/** The thresholds the filter offers — "at least this stale". */
export const CHASE_FILTERS = [
  { key: "all", label: "Everything", min: 0 },
  { key: "w2", label: "2 weeks+", min: 14 },
  { key: "w3", label: "3 weeks+", min: 21 },
  { key: "w4", label: "4 weeks+", min: 28 },
];

export function chaseBandOf(days) {
  // No date to count from is not the same as fresh, but it is certainly not
  // evidence of being late, so it sits in the bottom band rather than
  // inventing a fifth one for two rows.
  if (days === null || days === undefined) return "fresh";
  if (days >= 28) return "w4";
  if (days >= 21) return "w3";
  if (days >= 14) return "w2";
  return "fresh";
}

/**
 * The board totalled by whoever owns the work.
 *
 * Names are nominal — Veronica before Sarah means nothing — so every bar is
 * the same ramp and the colour says how late, never who. Sorted by how much
 * each is carrying, because that is the question the chart is asked.
 */
export function overviewFor(rows, now = today(), minDays = 0) {
  const by = new Map();
  for (const row of rows) {
    const days = quietDays(row, now);
    if (minDays > 0 && !(days !== null && days >= minDays)) continue;
    const who = String(row.assignee || "").trim() || "Unassigned";
    if (!by.has(who)) {
      by.set(who, { who, first: who.split(" ")[0], total: 0, bands: {}, worst: -1 });
    }
    const entry = by.get(who);
    entry.total += 1;
    const band = chaseBandOf(days);
    entry.bands[band] = (entry.bands[band] || 0) + 1;
    if (days !== null && days > entry.worst) entry.worst = days;
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.who.localeCompare(b.who));
}

export function matchesPill(row, pill) {
  if (!pill || pill === "all") return true;
  if (pill === "never") return neverContacted(row);
  if (pill === "reissued") return Number(row.timesOut) > 1;
  if (pill === "kind:accounts") return isAccount(row);
  if (pill === "kind:drawings") return !isAccount(row);
  if (pill.startsWith("who:")) return row.assignee === pill.slice(4);
  return true;
}

/**
 * Text as somebody would actually type it.
 *
 * Thirty-six of the forty-one task names carry a non-breaking space before
 * "Drawings" — it comes in from Asana, it's invisible on screen, and it is not
 * what anybody's keyboard produces. Without this, searching the project name
 * exactly as it appears finds nothing, which reads as a broken search box
 * rather than as a stray character nobody can see.
 */
export function plain(text) {
  return String(text ?? "")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One field, safe for a spreadsheet.
 *
 * Project names are free text somebody typed into Asana, so they carry commas,
 * quotes and the occasional line break. A field also can't be allowed to start
 * with =, +, - or @: Excel reads that as a formula, and these names come from
 * outside this system. Prefixing with an apostrophe keeps it text, which is
 * what it always was.
 */
function field(value) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const CSV_COLUMNS = [
  "Board",
  "Quiet days",
  "Quiet since",
  "Job",
  "Project",
  "Owner",
  "Product",
  "Issued",
  "Times out",
  "First issued",
  "Last contact",
  "Contacted by",
  "Chased",
  "Chased by",
  "Asana",
];

/**
 * The board as it stands, for a spreadsheet.
 *
 * Whatever is on screen — the filter and the search both apply, because
 * exporting all forty-one when you're looking at Mitchell's five is never what
 * was meant. Dates stay as ISO days so they sort; the board's "19 Nov" is for
 * reading, not for Excel.
 */
export function csvFor(rows, now = today()) {
  const body = rows.map((r) => [
    isAccount(r) ? "Accounts" : "Drawings",
    r.days === null || r.days === undefined ? quietDays(r, now) : r.days,
    // What the count is measured from, so a reader can check it rather than
    // having to work out which of the dates on the row the number came from.
    clockFrom(r).basis,
    r.crm,
    // Normalised here too: a non-breaking space in a spreadsheet is a silent
    // cause of failed lookups, and it carries no meaning worth preserving.
    plain(r.projectName),
    plain(r.assignee),
    plain(r.products),
    brisbaneDay(r.completedAt),
    r.timesOut ?? "",
    brisbaneDay(r.firstOutAt),
    brisbaneDay(r.lastContactAt),
    plain(r.lastContactBy),
    // The chase that still counts, matching the board. A chase from before
    // the current issue reads as blank here exactly as it reads as "never"
    // there, so filtering the spreadsheet gives the same answer as filtering
    // the board.
    chasedSinceIssue(r),
    r.chasedBy,
    r.permalink,
  ]);
  return [CSV_COLUMNS, ...body].map((line) => line.map(field).join(",")).join("\r\n");
}
