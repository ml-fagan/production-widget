// Shared vocabulary for the schedule board: the process columns, what each
// cell colour means, and the lead-time sum. Kept out of the page so the same
// rules are used wherever a row is drawn.

// Must stay in step with PROCESS_OPTIONS in the handover app. A step Mitch can
// assign but Duncan has no column for is a step that cannot be ticked: the job
// carries it, the board cannot show it, and it never completes.
export const PROCESS_COLUMNS = [
  "Materials",
  // Pressed in house rather than bought pressed. Second, because pressing is
  // the first thing that happens to a raw sheet — everything below is done to
  // a panel that has already been through it.
  "DecorPress",
  "Vitap",
  "CNC",
  "Edger",
  "Moulder",
  "Paint",
  "Acoustic",
  "Saw",
  "Assembly",
  "Packing",
];

// White = the job doesn't need this step, so there's nothing to track.
// The rest follow the spreadsheet: still to do, under way, finished.
export const CELL_COLOURS = {
  none: { bg: "transparent", label: "not part of this job" },
  todo: { bg: "#f3cfcd", label: "to do" },
  doing: { bg: "#f7dfb2", label: "in progress" },
  done: { bg: "#cfe3d4", label: "done" },
};

export const NEXT_STATE = { todo: "doing", doing: "done", done: "todo" };

/**
 * Materials is not Duncan's to click — it mirrors where Alice has got to, so
 * the board answers "can this job start?" without anyone asking her.
 */
export function materialsCellState(handover) {
  const state = handover.materialOrder?.state
    ?? (handover.materialOrder?.actioned ? "ordered" : "not_ordered");
  if (state === "arrived") return "done";
  if (state === "ordered") return "doing";
  return assignedProcesses(handover).has("materials") ? "todo" : "none";
}

/** The steps Mitch ticked at handover, lower-cased for comparison. */
export function assignedProcesses(handover) {
  return new Set(
    (handover.processes || []).map((p) => String(p).trim().toLowerCase())
  );
}

export function cellState(handover, column) {
  if (column.toLowerCase() === "materials") return materialsCellState(handover);
  if (!assignedProcesses(handover).has(column.toLowerCase())) return "none";
  return handover.schedule?.processState?.[column] || "todo";
}

/** Weeks from approval to committed, to one decimal. Null if either is unset. */
export function computedLead(approvalDate, committedDate) {
  if (!approvalDate || !committedDate) return null;
  const from = new Date(approvalDate).getTime();
  const to = new Date(committedDate).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round(((to - from) / (1000 * 60 * 60 * 24 * 7)) * 10) / 10;
}

/**
 * The approval in force on a job, as an event rather than a date.
 *
 * Three places can hold one. A project manager who recorded it on the system
 * wins outright: that is the only one with a name and a time against it, and
 * it is the answer the rest of the system shows — so a date Duncan typed
 * before the PM approved does not quietly outrank the approval itself.
 * Below that, Duncan's typed date, then the date Mitch had at handover.
 *
 * The handover is written before the job reaches the board and already carries
 * the date the work was approved to run. Making Duncan retype it gave two
 * places for one fact to live and an empty column until he got to it, which is
 * the column he reads to decide what goes first. His own entry still wins over
 * Mitch's — this fills the gap, it doesn't overrule him.
 *
 * Mirrors `approvalOf` in the handover app's schema; the two must agree.
 */
export function approvalOf(row) {
  const recorded = row?.approval;
  if (recorded?.source === "pm" && String(recorded.date || "").trim()) return recorded;
  const typed = String(row?.schedule?.approvalDate || "").trim();
  if (typed) return { date: typed, at: null, by: "", source: "schedule" };
  if (recorded && String(recorded.date || "").trim()) return recorded;
  const atHandover = String(row?.approvalDate || "").trim();
  if (atHandover) return { date: atHandover, at: null, by: "", source: "handover" };
  return null;
}

/**
 * Just the date, for the columns that only ever wanted the date.
 *
 * Board only. The production schedule is the company's record of what's been
 * committed, and a date inferred from somewhere else has no business appearing
 * there as though it were one — see boardLeadFor.
 */
export function approvalFor(row) {
  return approvalOf(row)?.date || "";
}

/** Duncan's override wins if he set one; otherwise the dates decide. */
export function leadFor(schedule) {
  if (!schedule) return null;
  if (typeof schedule.leadWeeks === "number") return schedule.leadWeeks;
  return computedLead(schedule.approvalDate, schedule.committedDate);
}

/**
 * leadFor for the schedule board, where an approval date inherited from the
 * handover counts. Kept separate rather than folded into leadFor so the
 * production schedule can't pick the fallback up by accident.
 */
export function boardLeadFor(row) {
  const schedule = row?.schedule;
  if (!schedule) return null;
  if (typeof schedule.leadWeeks === "number") return schedule.leadWeeks;
  return computedLead(approvalFor(row), schedule.committedDate);
}

// Same green scale as the spreadsheet: shorter lead times read darker.
export function leadShade(weeks) {
  if (weeks == null) return "transparent";
  if (weeks <= 3) return "#cfe3d4";
  if (weeks <= 5) return "#dfeade";
  if (weeks <= 7) return "#eef3e8";
  return "transparent";
}

/**
 * Which of the two boards a job runs on.
 *
 * Mirrors `streamsOf` in the handover app, and has to keep mirroring it: this
 * is the rule that decides which rows appear on Duncan's screen, and the two
 * apps disagreeing about it means a job that is built on a line nobody can
 * see.
 *
 * The asymmetry is deliberate. `fibreCement` used to mean "on the FC board
 * INSTEAD of the standard one", so on every record written before 5 November
 * 2026 its absence is a positive statement about standard production rather
 * than a missing field — which is why `standardProduction` is read through
 * `??` and not `Boolean()`.
 */
export function streamsOf(h) {
  const fc = Boolean(h?.fibreCement);
  const standard = h?.standardProduction ?? !fc;
  const streams = [];
  if (standard) streams.push("standard");
  if (fc) streams.push("fc");
  return streams.length ? streams : ["standard"];
}

export function onStream(h, stream) {
  return streamsOf(h).includes(stream);
}

/**
 * The key a pending edit is filed under: the job AND the board.
 *
 * By jobId alone, dating the MDF half of a job moved the fibre cement half
 * under Duncan's hands — the optimistic copy is what the row reads from until
 * the next refresh, so both rows would have shown the one date.
 */
export function editKey(jobId, stream) {
  return `${jobId}|${stream || "standard"}`;
}
