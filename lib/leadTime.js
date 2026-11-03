import { approvalFor } from "./board.js";

// How long a job takes, worked out rather than typed.
//
// The standalone planner had manufacturing as a field with 35 working days in
// it, and the schedule board has a Lead Time column somebody can override. Both
// are somebody's memory of last year. This derives the figure instead.
//
// The thing it derives it FROM is the part worth arguing about, and it is not
// the obvious one. History is the tempting source: jobs that have been through
// are finished, measured, beyond dispute. But a lead time is not a property of
// the factory, it is a property of the queue — a month that turned work around
// in three weeks may have had ten jobs in the building, and the month after it
// may have a hundred. Measuring the quiet month and promising it to a client
// booking into the busy one is how a forecast becomes a complaint.
//
// So this reads forward, not back: the lead on the jobs already SCHEDULED
// around the date in question. Those are real commitments Duncan has made with
// the real book in front of him, and they are the best available statement of
// how far out the factory is booking in that part of the year.
//
// Three rules follow the brief, and they are the reason this returns an object
// rather than a number:
//
//   * the middle, not the average — one job that sat for four months drags a
//     mean and tells you nothing about a typical one;
//   * a spread, not a point — "6.6 weeks" is false precision when the jobs
//     either side of it run 4 to 8;
//   * say when you do not know — a figure off four jobs and a figure off
//     eighty are not the same figure, and the caller is told which it has.
//
// There is no hidden margin anywhere in here. A client-facing date carrying a
// buffer the internal one does not is a lie that a dated record of your own
// eventually gets held against you. The honesty is in the window instead: the
// client sees a fortnight, not a day.

/** Days either side of the target date that count as "around then". */
const NEAR_DAYS = 30;
/** Widened to this before giving up on the neighbourhood entirely. */
const WIDE_DAYS = 60;
/** Below this, the neighbourhood is not telling us anything. */
const MIN_SAMPLES = 5;
/** Below this, say so on the board — see `thin`. */
const CONFIDENT_SAMPLES = 12;

/** The fortnight a client is shown instead of a day. Seven days either side. */
export const CLIENT_WINDOW_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

function toTime(iso) {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add days to an ISO date, calendar days, no timezone games. */
export function addDays(iso, days) {
  const t = toTime(iso);
  return t == null ? "" : toISO(t + days * DAY);
}

/**
 * The p-th value of a sorted list, by nearest rank.
 *
 * Nearest rank rather than interpolation: every value in here is a real job's
 * real lead, and a median that is the average of two jobs is a duration no job
 * ever had. Keeping to actual observations means every number on the board can
 * be pointed at a job.
 */
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

/**
 * Every job with both ends of a lead on it, as weeks.
 *
 * Keyed off the committed date, because that is the date the sample is ABOUT:
 * a job committed to March is evidence about March's queue whenever it was
 * approved. Jobs already finished are kept — they were scheduled too, and
 * dropping them would thin out exactly the recent end of the book.
 */
export function leadSamples(handovers) {
  const out = [];
  for (const h of handovers || []) {
    const committed = String(h?.schedule?.committedDate || "").trim();
    const approved = approvalFor(h);
    if (!committed || !approved) continue;
    const from = toTime(approved);
    const to = toTime(committed);
    if (from == null || to == null || to < from) continue;
    out.push({
      crm: h.jobId,
      committed,
      weeks: Math.round(((to - from) / (DAY * 7)) * 10) / 10,
    });
  }
  return out;
}

function summarise(values, basis, nearDays) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    /** The middle job. What a typical job in this part of the book takes. */
    weeks: quantile(sorted, 0.5),
    /** The middle half — the range the board and the client actually show. */
    low: quantile(sorted, 0.25),
    high: quantile(sorted, 0.75),
    n: sorted.length,
    /** "scheduled" = jobs around that date; "all" = the whole book. */
    basis,
    /** Days either side the sample was drawn from, for "all" it's null. */
    nearDays: nearDays ?? null,
    /** Too few to say this with a straight face — show it as a guess. */
    thin: sorted.length < CONFIDENT_SAMPLES,
  };
}

const NOTHING = {
  weeks: null,
  low: null,
  high: null,
  n: 0,
  basis: "none",
  nearDays: null,
  thin: true,
};

/**
 * How long a job landing around this date is taking.
 *
 * Tries the neighbourhood first, widens once, and only then falls back to the
 * whole book — at which point `basis` says so, because "typical for this time
 * of year" and "typical, ever" are different claims and the board should not
 * make the second while appearing to make the first.
 */
export function leadForDate(samples, isoDate, { near = NEAR_DAYS, wide = WIDE_DAYS } = {}) {
  const target = toTime(isoDate);
  if (!samples?.length) return NOTHING;
  if (target == null) {
    return summarise(samples.map((s) => s.weeks), "all");
  }

  for (const span of [near, wide]) {
    const inSpan = samples.filter((s) => {
      const t = toTime(s.committed);
      return t != null && Math.abs(t - target) <= span * DAY;
    });
    if (inSpan.length >= MIN_SAMPLES) {
      return summarise(inSpan.map((s) => s.weeks), "scheduled", span);
    }
  }
  return summarise(samples.map((s) => s.weeks), "all");
}

/**
 * When the drawings have to be approved for a date to be reachable.
 *
 * Works back from what the client needs by the lead the book is running at
 * around then. Returns the whole shape rather than a date, because the caller
 * has to know whether it is looking at a forecast or a commitment: `firm` is
 * true only once Duncan has committed the job, and until then every date in
 * here is the middle of a range and must never be rendered as a day.
 */
export function approvalDeadline(neededOnSite, samples, { committedDate = "" } = {}) {
  const needed = String(neededOnSite || "").slice(0, 10);
  if (!toTime(needed)) return { ...NOTHING, date: "", earliest: "", latest: "", firm: false };

  const firm = Boolean(String(committedDate || "").trim());
  // Once committed, the arithmetic runs from Duncan's date outwards: his date
  // is the fixed point and the deadline comes off it. The backwards chain from
  // what the client wants is the indicative calculation only.
  const anchor = firm ? String(committedDate).slice(0, 10) : needed;
  const lead = leadForDate(samples, anchor);
  if (lead.weeks == null) {
    return { ...lead, date: "", earliest: "", latest: "", firm };
  }

  const back = (weeks) => addDays(anchor, -Math.round(weeks * 7));
  return {
    ...lead,
    /** The middle of the range. Internal only while `firm` is false. */
    date: back(lead.weeks),
    /** Approving later than this and the far end of the book no longer fits. */
    earliest: back(lead.high),
    /** The optimistic end, for reading the spread rather than for promising. */
    latest: back(lead.low),
    firm,
  };
}

/**
 * The fortnight a client is shown in place of a date.
 *
 * Centred, so the window is an honest statement of where the middle sits
 * rather than a week of padding wearing a window's clothes. If it ever needs
 * to become "the date, plus a fortnight", this is the one constant to change.
 */
export function clientWindow(isoDate) {
  const t = toTime(isoDate);
  if (t == null) return { from: "", to: "" };
  return {
    from: toISO(t - CLIENT_WINDOW_DAYS * DAY),
    to: toISO(t + CLIENT_WINDOW_DAYS * DAY),
  };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The window in words, for a client page that must not be able to render a day.
 *
 * It takes the window rather than the date on purpose. Handing this a single
 * date and letting it format one is the exact failure the brief warns about —
 * a forecast rendered as a day because it was simpler, and nobody noticing
 * until somebody holds you to it.
 */
export function describeWindow({ from, to }) {
  const a = toTime(from);
  const b = toTime(to);
  if (a == null || b == null) return "";
  const da = new Date(a);
  const db = new Date(b);
  const sameMonth = da.getUTCMonth() === db.getUTCMonth() && da.getUTCFullYear() === db.getUTCFullYear();
  if (sameMonth) {
    return `between ${da.getUTCDate()} and ${db.getUTCDate()} ${MONTHS[db.getUTCMonth()]}`;
  }
  return `between ${da.getUTCDate()} ${MONTHS[da.getUTCMonth()]} and ${db.getUTCDate()} ${MONTHS[db.getUTCMonth()]}`;
}

/** The lead itself in words — a range, never a point. */
export function describeLead(lead) {
  if (!lead || lead.weeks == null) return "not enough scheduled work to say yet";
  const low = Math.floor(lead.low);
  const high = Math.ceil(lead.high);
  const range = low === high ? `about ${low} weeks` : `typically ${low} to ${high} weeks`;
  if (lead.basis === "all") return `${range} from approval, across the whole book`;
  return `${range} from approval`;
}
