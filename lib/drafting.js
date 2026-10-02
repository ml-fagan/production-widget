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
   * Accounts run on contact, not on issue.
   *
   * Nothing in that project is ever completed, so there is no issue date — and
   * the Follow Up field is deliberately not read. On Accounts it holds a date
   * to chase ON, in the future, which Veronica keeps up on sixty-nine of the
   * ninety-five. Reading that as "last contact" would treat a reminder for
   * next Tuesday as something that has already happened.
   */
  if (row.kind === "accounts") {
    const contacted = brisbaneDay(row.lastContactAt);
    if (contacted) return { day: contacted, basis: "contacted" };
    // Never commented on at all — count from when the account was opened.
    const opened = brisbaneDay(row.createdAt);
    if (opened) return { day: opened, basis: "opened" };
    return { day: "", basis: "none" };
  }

  const issued = brisbaneDay(row.completedAt);
  const chased = row.followUpAt || "";
  if (issued && chased) {
    return chased > issued ? { day: chased, basis: "chased" } : { day: issued, basis: "issued" };
  }
  if (issued) return { day: issued, basis: "issued" };
  if (chased) return { day: chased, basis: "chased" };
  return { day: "", basis: "none" };
}

/**
 * The last chase that still counts.
 *
 * A chase from before the current issue has been overtaken by it: the drawings
 * went out again afterwards, so nobody has chased THIS set. Empty rather than
 * stale, so "never chased" means what it says.
 */
export function chasedSinceIssue(row) {
  const { day, basis } = clockFrom(row);
  return basis === "chased" ? day : "";
}

/** Accounts carry a contact date; drawings carry a chase. */
export function isAccount(row) {
  return row.kind === "accounts";
}

/**
 * Nobody has recorded getting in touch.
 *
 * The same question on both boards, asked of whichever record each one keeps:
 * a drawing set nobody has chased since it went out, or an account nobody has
 * ever commented on.
 */
export function neverContacted(row) {
  return isAccount(row) ? !row.lastContactAt : !chasedSinceIssue(row);
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
    label: "Quiet for over a month",
    hint: "Nobody has touched these",
    urgent: true,
  },
  { key: "watch", label: "Two weeks to a month", hint: "" },
  { key: "fresh", label: "Recently out", hint: "" },
];

/**
 * Which band a row falls in.
 *
 * Bands rather than one long sort, because a sort can't say why. These put the
 * rows that matter today at the top, under a heading that names the reason.
 */
export function bandOf(days) {
  if (days === null || days === undefined) return "fresh";
  if (days > 30) return "aged";
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
    { key: "all", label: "Everything", count: rows.length },
    { key: "kind:drawings", label: "Drawings", count: rows.filter((r) => !isAccount(r)).length },
    { key: "kind:accounts", label: "Accounts", count: rows.filter(isAccount).length },
    {
      // Not chased SINCE the current issue, or never commented on at all.
      // A chase from before the drawings went out again hasn't chased this
      // set, and counting it would hide the row from the one filter meant to
      // catch it.
      key: "never",
      label: "Never chased",
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
  ].filter((p) => p.count > 0 || p.key === "all");
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
