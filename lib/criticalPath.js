import { promisedDelivery, lastApprovalDate, missesRequirement } from "./leadTime.js";
import { brisbaneDay, today as brisbaneToday } from "./drafting.js";

// The critical path for one project: the five things that have to happen, in
// order, and where this job has got to.
//
// Taken from the standalone Critical Path Planner, with one deliberate change.
// The planner calculates backwards from a required delivery date through
// delivery, contingency, manufacturing, client approval and drafting — which
// is the right calculation for a job nobody has signed yet, and the wrong one
// the moment somebody does. Once a client signs, that date is the fixed point
// and everything runs FORWARD from it; once Duncan commits every part, his
// dates replace the forecast entirely. So this uses the backwards chain only
// where there is nothing better, and says which it is using.
//
// The other difference is what the milestones ARE. The planner's were a
// proposal — deposit, drawings, approval, manufacturing, delivery. These are
// the five the system can actually answer for, each off a record somebody
// keeps as part of their job rather than a field somebody would have to
// maintain for this board:
//
//   Drawings issued   the drafting register — Mitch ticking the Asana task
//   Client approved   the approval somebody recorded against the project
//   Material ordered  Alice's board, across every part
//   In production     a process step moving on the schedule board
//   Delivery          Duncan's committed dates, or the forecast
//
// Deposit is missing on purpose. The planner has payment terms and this
// system has nowhere to put them: inventing a field for a milestone nobody
// records would give the board a column that is blank on every job.

export const MILESTONES = [
  { key: "drawings", label: "Drawings issued" },
  { key: "approved", label: "Client approved" },
  { key: "material", label: "Material ordered" },
  { key: "production", label: "In production" },
  { key: "delivery", label: "Delivery" },
];

function dayOf(iso) {
  const s = String(iso || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** A date the way somebody says it, for the sentence on the card. */
function prettyDay(iso) {
  const day = dayOf(iso);
  if (!day) return "";
  const [y, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

function latest(values) {
  const days = values.map(dayOf).filter(Boolean).sort();
  return days.length ? days[days.length - 1] : "";
}

function earliest(values) {
  const days = values.map(dayOf).filter(Boolean).sort();
  return days.length ? days[0] : "";
}

/**
 * Where the material has got to, across every part of the job.
 *
 * The weakest link: a project is not "ordered" because one of its four parts
 * is. Alice works part by part and the client takes delivery of the job.
 */
function materialState(parts) {
  if (!parts.length) return "none";
  const states = parts.map((p) => p.materialOrder?.state || "not_ordered");
  if (states.every((s) => s === "arrived")) return "arrived";
  if (states.every((s) => s === "arrived" || s === "ordered")) return "ordered";
  if (states.some((s) => s === "arrived" || s === "ordered")) return "part";
  return "not_ordered";
}

const STARTED = new Set(["in_production", "despatched", "invoiced", "closed"]);

/**
 * The chain for one project.
 *
 * `parts` are its handovers, `draftingRows` the drawing sets the register
 * holds for it, `plan` the project's own record, `samples` the lead-time
 * population. Everything here is derived at read time — nothing about a
 * critical path is stored, because every input to it is already stored
 * somewhere by the person whose job it is.
 */
export function criticalPath({ parts = [], draftingRows = [], plan = {}, samples = [], todayISO }) {
  /**
   * Today in Brisbane, not today in UTC.
   *
   * `new Date().toISOString()` is ten hours behind us, so for most of the
   * working day it names yesterday — and on this board that is the difference
   * between a delivery reading overdue and reading fine. It is the trap the
   * build brief names, and it had already caught this function once.
   */
  const today = todayISO || brisbaneToday();

  const approvalDate = dayOf(
    parts.map((p) => p.approval?.date).find(Boolean) ||
      parts.map((p) => p.approvalDate).find(Boolean)
  );
  const approvalSource =
    parts.map((p) => p.approval).find((a) => a?.date)?.source || (approvalDate ? "handover" : "");
  const approvedBy = parts.map((p) => p.approval).find((a) => a?.date)?.by || "";

  // Drawings: the register records an issue as the task being ticked
  // complete. A set reissued after a revision ticks again, so the latest is
  // the one the job is running on. The stamps are timestamps, so they come
  // through brisbaneDay rather than being sliced — a set ticked after 2pm
  // here is the next day in UTC.
  const issued = latest(draftingRows.map((r) => brisbaneDay(r.completedAt)));

  const material = materialState(parts);
  const materialDate =
    material === "not_ordered" || material === "none"
      ? ""
      : latest(parts.flatMap((p) => (p.materials || []).map((m) => m.orderedAt)));

  const started = parts.some((p) => STARTED.has(p.state));
  const everyPartCommitted = parts.length > 0 && parts.every((p) => p.schedule?.committedDate);
  const committed = latest(
    parts.map((p) => p.schedule?.actualDate || p.schedule?.committedDate || "")
  );
  const delivered = parts.length > 0 && parts.every((p) => p.schedule?.completedAt);
  const deliveredOn = delivered ? latest(parts.map((p) => p.schedule?.completedAt)) : "";

  // The forecast, and the deadline that falls out of it.
  const forecast = approvalDate ? promisedDelivery(approvalDate, samples) : null;
  const deadline =
    !approvalDate && plan.neededOnSite
      ? lastApprovalDate(plan.neededOnSite, samples, { adjustDays: plan.approvalAdjustDays || 0 })
      : null;

  /**
   * What we would tell the client.
   *
   * Duncan's dates win once every part has one — his date is the commitment
   * and the forecast is what stands in for it until it exists. A job with
   * three parts committed and one not is still a forecast, because the
   * project is delivered when the last part goes.
   */
  const promised = delivered ? deliveredOn : everyPartCommitted ? committed : forecast?.client || "";
  const promiseBasis = delivered
    ? "delivered"
    : everyPartCommitted
      ? "committed"
      : forecast?.client
        ? "forecast"
        : "unknown";

  const against =
    promised && plan.neededOnSite ? missesRequirement(promised, plan.neededOnSite) : null;

  const state = (done, date, { target = "" } = {}) => {
    if (done) return "done";
    const by = target || date;
    if (by && by < today) return "overdue";
    return "upcoming";
  };

  const steps = [
    {
      ...MILESTONES[0],
      date: issued,
      /**
       * Issued if the register says so — or if the client has approved,
       * because you cannot approve drawings that never went out.
       *
       * That inference matters more than it looks. The drafting register is
       * a live queue, not a history: a set leaves it once the job moves on,
       * so only seven of sixty-nine live projects have a row. Reading the
       * register alone would leave the first circle blank on nearly every
       * card, which says "we don't know" about the one step we can be
       * certain of.
       *
       * Three states, because "no row and not approved" genuinely is unknown
       * rather than not-yet — and an unknown step must stay out of the
       * chain's one live marker, or a job on the saw reads as waiting for
       * its drawings.
       */
      state: issued || approvalDate ? "done" : draftingRows.length ? "upcoming" : "unknown",
      note: issued
        ? draftingRows.length > 1
          ? `${draftingRows.length} sets`
          : ""
        : approvalDate
          ? "before approval"
          : draftingRows.length
            ? "with the drafters"
            : "not in the register",
    },
    {
      ...MILESTONES[1],
      date: approvalDate || deadline?.client || "",
      state: approvalDate ? "done" : state(false, "", { target: deadline?.client }),
      note: approvalDate
        ? approvalSource === "pm"
          ? approvedBy || "recorded"
          : "typed on the handover"
        : deadline?.client
          ? "needed by"
          : "no site date set",
    },
    {
      ...MILESTONES[2],
      date: materialDate,
      state:
        material === "arrived" || material === "ordered"
          ? "done"
          : material === "part"
            ? "current"
            : "upcoming",
      note:
        material === "arrived"
          ? "all in"
          : material === "part"
            ? "some parts outstanding"
            : material === "ordered"
              ? "on order"
              : "",
    },
    {
      ...MILESTONES[3],
      date: "",
      state: delivered ? "done" : started ? "current" : "upcoming",
      note: started && !delivered ? "under way" : "",
    },
    {
      ...MILESTONES[4],
      date: promised,
      state: delivered
        ? "done"
        : promised && promised < today
          ? "overdue"
          : "upcoming",
      note:
        promiseBasis === "forecast"
          ? "forecast"
          : promiseBasis === "committed"
            ? "committed"
            : promiseBasis === "delivered"
              ? "out the door"
              : "",
    },
  ];

  /**
   * Exactly one live step.
   *
   * The first thing not finished is what the job is waiting on — but only
   * where nothing further along has already said it is under way. A job on
   * the saw with no register row was showing two blue circles, and a chain
   * with two "here" marks tells you less than one with none.
   */
  if (!steps.some((s) => s.state === "current" || s.state === "overdue")) {
    const firstOpen = steps.findIndex((s) => s.state === "upcoming");
    if (firstOpen >= 0) steps[firstOpen].state = "current";
  }

  let band = "fine";
  let headline = "";
  if (!approvalDate && deadline?.client) {
    const left = Math.round(
      (Date.parse(`${deadline.client}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000
    );
    band = left < 0 ? "overdue" : left <= 14 ? "soon" : "fine";
    headline =
      left < 0
        ? `Sign-off was needed ${-left} ${-left === 1 ? "day" : "days"} ago to hold the site date.`
        : `Sign-off needed within ${left} ${left === 1 ? "day" : "days"} to hold the site date.`;
  } else if (against) {
    band = against.late ? "overdue" : against.days > -14 ? "soon" : "fine";
    const promise = `${
      promiseBasis === "forecast" ? "Forecast" : promiseBasis === "delivered" ? "Delivered" : "Promised"
    } ${prettyDay(promised)}, needed on site ${prettyDay(plan.neededOnSite)}`;
    headline = against.late
      ? `${promise} — ${against.days} ${against.days === 1 ? "day" : "days"} late.`
      : `${promise} — ${-against.days} ${-against.days === 1 ? "day" : "days"} spare.`;
  } else if (!plan.neededOnSite) {
    headline = "No site date recorded, so there is nothing to measure the promise against.";
  }

  return {
    steps,
    approvalDate,
    approvalSource,
    promised,
    promiseBasis,
    forecast,
    deadline,
    against,
    band,
    headline,
    delivered,
  };
}
