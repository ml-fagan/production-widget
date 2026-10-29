import { fetchLoggedHandovers } from "../../../lib/handovers.js";
import { boardLeadFor } from "../../../lib/board.js";
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
    const asRow = (h) => {
      const committed = h.schedule?.committedDate || null;
      const actual = h.schedule?.actualDate || null;
      const completed = h.schedule?.completedAt || null;
      return {
        crm: h.jobId,
        project: h.project || h.client || "",
        committed,
        actual,
        dispatch: actual || committed,
        completed,
        priority: h.schedule?.priority || "",
        // Weeks, which is what the spreadsheet's Lead Time column held and
        // what the schedule board shows.
        lead: boardLeadFor(h),
        // Past its date and not finished. A job Duncan has stamped complete is
        // never overdue however old its dates are — the sheet had no way to
        // know that, which is what left delivered jobs flagged late forever.
        overdue: Boolean(
          committed && !completed && new Date((actual || committed) + "T00:00:00") < today
        ),
      };
    };

    const dated = handovers.filter((h) => h.schedule?.committedDate);
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
