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
 * How long nobody has done anything about this job.
 *
 * Chased, if it has been — the Follow Up date means "I chased on this day".
 * Otherwise since it was last issued.
 *
 * `completedAt` rather than `modifiedAt`, and the difference matters: both
 * usually agree, because ticking a task complete is often the last thing done
 * to it. They part when somebody edits the task afterwards — a product tag, an
 * assignee — and `modifiedAt` jumps while nothing happened with the client.
 * That failure is silent and runs one way only: a stale job looks fresh.
 */
export function quietDays(row, now = today()) {
  const from = row.followUpAt || brisbaneDay(row.completedAt);
  if (!from) return null;
  return daysBetweenDays(from, now);
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
    { key: "all", label: "All issued", count: rows.length },
    {
      key: "never",
      label: "Never chased",
      count: rows.filter((r) => !r.followUpAt).length,
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
  if (pill === "never") return !row.followUpAt;
  if (pill === "reissued") return Number(row.timesOut) > 1;
  if (pill.startsWith("who:")) return row.assignee === pill.slice(4);
  return true;
}
