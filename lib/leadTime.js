import { approvalFor } from "./board.js";

// How long a job takes, worked out rather than typed — and what we therefore
// promise a client.
//
// The clock starts when the client signs. Somebody here records that date, and
// everything after it is arithmetic: delivery is the approval plus how long
// jobs are currently taking. That is the direction that matters, because it is
// the direction a promise runs in. Working backwards from a date a client
// wants is the other question — what is the last day they can sign and still
// get it — and this does both, but the forward one is the one that becomes a
// commitment.
//
// The lead it uses is derived, not typed. The standalone planner had
// manufacturing as a field with 35 working days in it and the schedule board
// has a column somebody can override; both are somebody's memory of last year.
//
// What it derives the figure FROM is the part worth arguing about, and it is
// not the obvious one. History is tempting: finished jobs are measured and
// beyond dispute. But a lead time is not a property of the factory, it is a
// property of the queue — a month that turned work around in three weeks may
// have had ten jobs in the building, and the month after may have a hundred.
// Measuring the quiet month and promising it into the busy one is how a
// forecast becomes a complaint. So this reads the jobs already SCHEDULED
// around the date in question: real commitments Duncan made with the real book
// in front of him, and the best available statement of how far out the factory
// is booking.
//
// One number, not a range. The middle job — the median — and it moves as the
// book moves. A spread is the more honest object and it is kept on the result
// for anything internal that wants it, but nothing shown to a person renders
// it: "we will deliver between the 10th and the 24th" is not a promise, it is
// a way of not making one.

/** Days either side of the target date that count as "around then". */
const NEAR_DAYS = 30;
/** Widened to this before giving up on the neighbourhood entirely. */
const WIDE_DAYS = 60;
/** Below this, the neighbourhood is not telling us anything. */
const MIN_SAMPLES = 5;
/** Below this, say so internally — see `thin`. */
const CONFIDENT_SAMPLES = 12;

/**
 * The week between a client signing and the job reaching the floor.
 *
 * The schedule's own lead runs approval to committed date, which is what the
 * factory experiences. A client's promise has to carry the step before that
 * as well — the handover being written, the material being ordered, the job
 * being picked up and put into the book. That is about a week, and it is real
 * work rather than padding.
 *
 * It is the ONLY difference between the internal date and the client's, and
 * it is applied in the safe direction in both: a delivery promised a week
 * later, an approval asked for a week sooner.
 */
export const HANDOVER_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

function toTime(iso) {
  const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

function toISO(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Add days to an ISO date. Calendar days, no timezone games. */
export function addDays(iso, days) {
  const t = toTime(iso);
  return t == null ? "" : toISO(t + Math.round(days) * DAY);
}

/**
 * The p-th value of a sorted list, by nearest rank.
 *
 * Nearest rank rather than interpolation: every value in here is a real job's
 * real lead, and a median that is the average of two jobs is a duration no job
 * ever had. Keeping to actual observations means every number can be pointed
 * at a job.
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
 * approved. Finished jobs are kept — they were scheduled too, and dropping
 * them would thin out exactly the recent end of the book.
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
    /** The number. The middle job in this part of the book. */
    weeks: quantile(sorted, 0.5),
    /**
     * The middle half. Kept for judging whether the median means anything —
     * a tight spread and a wide one are different situations — but nothing
     * client-facing shows it, and nothing should start.
     */
    low: quantile(sorted, 0.25),
    high: quantile(sorted, 0.75),
    n: sorted.length,
    /** "scheduled" = jobs around that date; "all" = the whole book. */
    basis,
    nearDays: nearDays ?? null,
    /** Too few to stand behind. Internal warning, not a client-facing hedge. */
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
 * of year" and "typical, ever" are different claims.
 */
export function leadForDate(samples, isoDate, { near = NEAR_DAYS, wide = WIDE_DAYS } = {}) {
  if (!samples?.length) return NOTHING;
  const target = toTime(isoDate);
  if (target == null) return summarise(samples.map((s) => s.weeks), "all");

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
 * When a job approved on this date is delivered.
 *
 * The forward direction, and the one that becomes a promise. The client signs,
 * somebody records the date, and this says when they get it.
 *
 * The queue it reads is the queue the job will land in, which is not the one
 * it was approved in — so the lead is picked twice: once around the approval
 * to get a first estimate, then again around where that estimate lands. One
 * iteration, because a second never moves it far enough to matter and a loop
 * that chases its own tail is worse than a figure that is a few days out.
 *
 *   internal  what the factory is running at
 *   client    plus the week it takes to reach the floor
 *
 * No hand adjustment here, deliberately. The project manager's days are for
 * the approval deadline — a thing we ask of a client — and not for the date
 * we commit to giving them. A promise somebody can nudge is not a promise.
 */
export function promisedDelivery(approvalDate, samples) {
  const approved = String(approvalDate || "").slice(0, 10);
  if (toTime(approved) == null) {
    return { ...NOTHING, approvalDate: "", internal: "", client: "" };
  }

  const first = leadForDate(samples, approved);
  if (first.weeks == null) {
    return { ...first, approvalDate: approved, internal: "", client: "" };
  }
  const landsAbout = addDays(approved, first.weeks * 7);
  const lead = leadForDate(samples, landsAbout);
  const weeks = lead.weeks ?? first.weeks;

  const internal = addDays(approved, weeks * 7);
  return {
    ...lead,
    weeks,
    approvalDate: approved,
    /** What the factory is working to. */
    internal,
    /** What the client is told. Later, never earlier. */
    client: addDays(internal, HANDOVER_DAYS),
  };
}

/**
 * The last day a client can sign and still have it when they need it.
 *
 * The backward direction, for a job that has not been approved yet. It is a
 * deadline rather than a promise — a thing we need from them, not a thing we
 * owe them — which is why it is a single date and why the extra week lands on
 * their side of it.
 *
 *   internal  needed on site, less what the factory is running at
 *   client    a week earlier again, plus the project manager's adjustment
 *             (positive gives them longer, negative asks for it sooner)
 */
export function lastApprovalDate(neededOnSite, samples, { adjustDays = 0 } = {}) {
  const needed = String(neededOnSite || "").slice(0, 10);
  if (toTime(needed) == null) {
    return { ...NOTHING, neededOnSite: "", internal: "", client: "", adjustDays: 0 };
  }

  const lead = leadForDate(samples, needed);
  if (lead.weeks == null) {
    return { ...lead, neededOnSite: needed, internal: "", client: "", adjustDays: 0 };
  }

  const internal = addDays(needed, -lead.weeks * 7);
  return {
    ...lead,
    neededOnSite: needed,
    internal,
    client: addDays(internal, -HANDOVER_DAYS + adjustDays),
    adjustDays,
  };
}

/**
 * Is the promise late for what they asked for?
 *
 * The needed-on-site date never moves Duncan's schedule and never changes a
 * committed date. This is the only thing it does: it gets compared, and the
 * board says so on the day the job is approved rather than on the day it is
 * due.
 */
export function missesRequirement(promisedISO, neededOnSite) {
  const promised = toTime(promisedISO);
  const needed = toTime(neededOnSite);
  if (promised == null || needed == null) return null;
  return {
    late: promised > needed,
    days: Math.round((promised - needed) / DAY),
  };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A date in words, for a page that reads rather than tabulates. */
export function describeDate(iso) {
  const t = toTime(iso);
  if (t == null) return "";
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The lead itself, as the one number. */
export function describeLead(lead) {
  if (!lead || lead.weeks == null) return "not enough scheduled work to say yet";
  const weeks = Math.round(lead.weeks * 10) / 10;
  return `${weeks} weeks from approval`;
}
