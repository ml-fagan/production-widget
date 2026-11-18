/**
 * The days the factory is shut, and what they do to a lead.
 *
 * A mirror of decorhandover's lib/closedowns.ts — the two apps both measure
 * leads and must agree about them to the day, the same way criticalPath is a
 * matched pair. If one changes, change the other.
 *
 * Why it exists: the lead on the schedule board is the span from the client
 * approving to the date the job is committed to, and across a three-week
 * Christmas shutdown that span reads as twelve weeks of work when nine of
 * them were work and three were nobody being here.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Is the factory shut on this day? */
export function isClosed(day, periods) {
  return (periods || []).some((p) => day >= p.from && day <= p.to);
}

/**
 * Days shut between two dates, counting the days AFTER `from` up to and
 * including `to` — the same window a lead measures.
 *
 * Walked rather than worked out in closed form: a span is months at most,
 * the list is a handful of rows, and an overlap calculation that has to cope
 * with periods touching and overlapping is a worse thing to get wrong than a
 * loop is to be slow.
 */
export function closedDaysBetween(from, to, periods) {
  if (!DAY.test(from || "") || !DAY.test(to || "") || !(periods || []).length) return 0;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 0;
  const total = Math.round((end - start) / 86400000);
  if (total > 2000) return 0;
  let shut = 0;
  for (let i = 1; i <= total; i += 1) {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
    if (isClosed(day, periods)) shut += 1;
  }
  return shut;
}

/**
 * The lead in weeks with the shutdown taken out.
 *
 * Identical to a plain span when nothing is in the way, which is most of the
 * year and all of the past — a board with no calendar filled in reads exactly
 * as it always did.
 */
export function leadWeeksOpen(approvalDate, committedDate, periods) {
  if (!approvalDate || !committedDate) return null;
  const from = String(approvalDate).slice(0, 10);
  const to = String(committedDate).slice(0, 10);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = (end - start) / 86400000 - closedDaysBetween(from, to, periods);
  return Math.round((days / 7) * 10) / 10;
}

/**
 * Move `days` OPEN days from a date, in calendar days, stepping over the days
 * the factory is shut. Negative walks backwards.
 *
 * The other half of taking a shutdown out of a lead: leadWeeksOpen measures a
 * span in days somebody was here, this spends one. A nine-week lead from 5
 * December lands nine weeks of work later, which is the January date plus the
 * shutdown in between.
 */
export function addOpenDays(iso, days, periods) {
  const start = Date.parse(`${String(iso ?? "").slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start)) return "";
  const want = Math.round(days);
  if (!(periods || []).length) return new Date(start + want * 86400000).toISOString().slice(0, 10);

  const step = want < 0 ? -1 : 1;
  let left = Math.abs(want);
  let at = start;
  let guard = Math.abs(want) + 3650;
  while (left > 0 && guard-- > 0) {
    at += step * 86400000;
    if (!isClosed(new Date(at).toISOString().slice(0, 10), periods)) left -= 1;
  }
  return new Date(at).toISOString().slice(0, 10);
}

/** The shutdowns a span runs through, for saying why a number is what it is. */
export function closedownsBetween(from, to, periods) {
  if (!DAY.test(from || "") || !DAY.test(to || "")) return [];
  const [first, last] = from <= to ? [from, to] : [to, from];
  return (periods || [])
    .filter((p) => p.from <= last && p.to >= first)
    .sort((a, b) => a.from.localeCompare(b.from));
}
