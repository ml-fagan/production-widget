// Working days — Monday to Friday, weekends skipped.
//
// The company works weekdays, so every day count on these boards is in
// weekdays: how long a set has sat with a client, how long a supplier took.
// Counting the weekend made every figure worse than it was by two days a
// week, and the long ones by the better part of a month.
//
// Public holidays are deliberately not in it. They would need a calendar
// somebody maintains, and a stale one is worse than none — the error is a day
// or two a year against numbers whose job is to say "this took too long".
//
// Its own file because three screens count in it now: the drafting board's
// quiet clock, the register's sync, and the material board's lead times. A
// third copy would be a third thing to drift.

const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

/** The Brisbane calendar day an instant falls on, as YYYY-MM-DD. */
export function brisbaneDay(at) {
  if (!at) return "";
  const when = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(when.getTime())) return "";
  return new Date(when.getTime() + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Working days between two calendar days, as YYYY-MM-DD.
 *
 * Counts the days AFTER `from`, up to and including `to`, so Friday to Monday
 * is one and Friday to Saturday is nought. Negative when `to` is the earlier
 * of the two, the way a plain day difference is.
 *
 * Closed form rather than a loop: the oldest rows run to six months and this
 * is called for every row on every render.
 */
export function workingDaysBetween(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const sign = b < a ? -1 : 1;
  const start = Math.min(a, b);
  const total = Math.round((Math.max(a, b) - start) / 86400000);
  const startDay = new Date(start).getUTCDay(); // 0 Sunday … 6 Saturday
  // Any seven consecutive days hold five working ones, whichever day they
  // start on, so only the remainder has to be walked.
  const weeks = Math.floor(total / 7);
  let count = weeks * 5;
  for (let i = weeks * 7 + 1; i <= total; i += 1) {
    const weekday = (startDay + i) % 7;
    if (weekday !== 0 && weekday !== 6) count += 1;
  }
  return sign * count;
}

/**
 * The same, between two timestamps.
 *
 * Taken to Brisbane calendar days first and counted in whole days, which is
 * what these boards mean by a day: an order placed at 4pm Tuesday and booked
 * in at 10am Thursday took two days, not one and three-quarters.
 */
export function workingDaysBetweenStamps(from, to) {
  const a = brisbaneDay(from);
  const b = brisbaneDay(to);
  if (!a || !b) return null;
  return workingDaysBetween(a, b);
}
