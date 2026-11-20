import { fetchLoggedHandovers, closedownsSeen } from "../../../lib/handovers.js";
import { boardLeadFor, streamsOf, scheduleFieldFor } from "../../../lib/board.js";
import { baseCrm, crmLooksValid } from "../../../lib/crmUtils.js";
import {
  fetchProductionTasks,
  buildAsanaLookup,
  checkAgainstAsana,
} from "../../../lib/asana.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Single-job lookup for the handover app (decorhandover.lyphex.com), which
// asks "what do the schedule and Asana already say about this CRM?" so the
// handover form can show it instead of somebody opening three systems.
//
// The schedule half used to be read out of Jordan's spreadsheet. The floor
// has stopped using it, so the dates now come from the handover records
// themselves — the same place the handover app would look, but it asks here
// because the Asana token lives in this app and should stay in one of them.
//
// Machine-to-machine: authorised with a shared bearer secret rather than the
// staff password cookie, so it stays out of the browser. The middleware lets
// this route through when the header matches; the check is repeated here so
// the route is never open on its own.

function authorised(req) {
  const expected = process.env.JOB_API_SECRET || "";
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

const noStore = { "Cache-Control": "no-store" };

export async function GET(req) {
  if (!authorised(req)) {
    return Response.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers: noStore }
    );
  }

  const crm = String(req.nextUrl.searchParams.get("crm") || "").trim();
  if (!crmLooksValid(crm)) {
    return Response.json(
      { ok: false, error: "Missing or malformed crm." },
      { status: 400, headers: noStore }
    );
  }

  try {
    const [handovers, asanaResult] = await Promise.all([
      fetchLoggedHandovers().catch(() => []),
      fetchProductionTasks()
        .then((tasks) => ({ lookup: buildAsanaLookup(tasks) }))
        // Asana is a cross-check, not the source of truth — a job lookup still
        // returns the schedule row if Asana is down or the token is unset.
        .catch((err) => ({ lookup: null, error: String(err.message || err) })),
    ]);

    // The same row shape the spreadsheet used to produce, so the handover
    // app's JobContext needed no change: what it was promised for, what it
    // actually went out on, and whether it is finished.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /**
     * One line's dates, for a job or for one load of one.
     *
     * `schedule` is not "the standard line" and `fcSchedule` is not "the
     * fibre cement line" — `fcSchedule` is the SECOND line's, and only exists
     * for a job that runs on both. Reading it any other way is what emptied
     * the fibre cement board the morning two-line work shipped, so this goes
     * through `scheduleFieldFor` like everything else.
     */
    const lineOf = (job, holder, stream) => {
      const s = holder?.[scheduleFieldFor(job, stream)] || {};
      const committed = s.committedDate || null;
      const actual = s.actualDate || null;
      const completed = s.completedAt || null;
      return {
        stream,
        committed,
        actual,
        dispatch: actual || committed,
        completed,
        overdue: Boolean(
          committed && !completed && new Date((actual || committed) + "T00:00:00") < today
        ),
      };
    };

    const asRow = (h) => {
      const committed = h.schedule?.committedDate || null;
      const actual = h.schedule?.actualDate || null;
      const completed = h.schedule?.completedAt || null;
      const streams = streamsOf(h);
      return {
        crm: h.jobId,
        project: h.project || h.client || "",
        committed,
        actual,
        dispatch: actual || committed,
        completed,
        priority: h.schedule?.priority || "",
        /**
         * Which of Duncan's two lines builds it, and each line's own dates.
         *
         * The flat `committed`/`actual` above are the first line's, kept
         * exactly as they were so nothing reading this breaks. They were also
         * the WHOLE answer, which on a job running on both lines is half of
         * it: the fibre cement half can be a fortnight behind the MDF half,
         * and the job is not out the door until both have gone. The handover
         * form showed one date and said nothing about the other.
         */
        streams,
        lines: streams.map((stream) => lineOf(h, h, stream)),
        /**
         * The loads, where it goes out in more than one.
         *
         * A split job has no committed date OF ITS OWN by design — the
         * roll-up empties it until every load has one, because the client's
         * job is done when the last truck goes. So the lookup found nothing
         * and the handover said "no row on the production schedule" about a
         * job with four dated loads on two boards. The dates exist; they are
         * just one level down.
         */
        loads: (h.despatch ?? []).map((part) => ({
          crm: part.jobId,
          suffix: part.suffix,
          out: part.despatchDate || null,
          lines: streams.map((stream) => lineOf(h, part, stream)),
        })),
        // Weeks, which is what the spreadsheet's Lead Time column held and
        // what the schedule board shows.
        lead: boardLeadFor(h, closedownsSeen()),
        // Past its date and not finished. A job Duncan has stamped complete is
        // never overdue however old its dates are — the sheet had no way to
        // know that, which is what left delivered jobs flagged late forever.
        overdue: Boolean(
          committed && !completed && new Date((actual || committed) + "T00:00:00") < today
        ),
      };
    };

    /**
     * Everything Duncan has given a date to, wherever that date lives.
     *
     * It was `h.schedule?.committedDate` alone, which quietly excluded two
     * kinds of job that very much are on his board: one running on both
     * lines whose only date so far is the fibre cement half, and a split one,
     * whose own date is empty BY DESIGN because the roll-up clears it until
     * every load has one. 21027-1 has four dated loads across two boards and
     * the handover form said there was no row for it.
     */
    const dated = handovers.filter(
      (h) =>
        h.schedule?.committedDate ||
        h.fcSchedule?.committedDate ||
        (h.despatch ?? []).some(
          (p) => p.schedule?.committedDate || p.fcSchedule?.committedDate
        )
    );
    const wanted = crm.toLowerCase();
    const found = dated.find((h) => String(h.jobId).trim().toLowerCase() === wanted);
    const job = found ? asRow(found) : null;

    // Other parts of the same top-level job — useful context when a handover
    // is one of several splits (19289-1, 19289-2, ...).
    const base = baseCrm(crm);
    const siblings = dated
      .filter((h) => {
        const c = String(h.jobId).trim().toLowerCase();
        return baseCrm(c) === base && c !== wanted;
      })
      .map(asRow);

    return Response.json(
      {
        ok: true,
        crm,
        job,
        siblings,
        scheduled: Boolean(job),
        // Checked whether or not the schedule has a row: a handover exists
        // before anything is scheduled, so the Asana task is often the only
        // thing that knows about the job yet. With no row there's no dispatch
        // date to compare against, so the caller reads `scheduled` to know
        // whether a date difference means anything.
        asana: asanaResult.lookup
          ? checkAgainstAsana(job || { crm, dispatch: null }, asanaResult.lookup)
          : { status: "warn", reason: "asana_unavailable", error: asanaResult.error },
        fetchedAt: new Date().toISOString(),
      },
      { headers: noStore }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err.message || err) },
      { status: 500, headers: noStore }
    );
  }
}
