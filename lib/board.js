// Shared vocabulary for the schedule board: the process columns, what each
// cell colour means, and the lead-time sum. Kept out of the page so the same
// rules are used wherever a row is drawn.

export const PROCESS_COLUMNS = [
  "Materials",
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

/** Duncan's override wins if he set one; otherwise the dates decide. */
export function leadFor(schedule) {
  if (!schedule) return null;
  if (typeof schedule.leadWeeks === "number") return schedule.leadWeeks;
  return computedLead(schedule.approvalDate, schedule.committedDate);
}

// Same green scale as the spreadsheet: shorter lead times read darker.
export function leadShade(weeks) {
  if (weeks == null) return "transparent";
  if (weeks <= 3) return "#cfe3d4";
  if (weeks <= 5) return "#dfeade";
  if (weeks <= 7) return "#eef3e8";
  return "transparent";
}
