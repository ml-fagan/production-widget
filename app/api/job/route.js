import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";
import { baseCrm, crmLooksValid } from "../../../lib/crmUtils.js";
import {
  fetchProductionTasks,
  buildAsanaLookup,
  checkAgainstAsana,
} from "../../../lib/asana.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Single-job lookup for the handover app (decorhandover.lyphex.com), which
// asks "what does the schedule and Asana already say about this CRM?" so the
// handover form can show it instead of the operator opening three systems.
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
    const [{ buffer, lastModified }, asanaResult] = await Promise.all([
      downloadScheduleBuffer(),
      fetchProductionTasks()
        .then((tasks) => ({ lookup: buildAsanaLookup(tasks) }))
        // Asana is a cross-check, not the source of truth — a job lookup still
        // returns the schedule row if Asana is down or the token is unset.
        .catch((err) => ({ lookup: null, error: String(err.message || err) })),
    ]);

    const { jobs } = parseSchedule(buffer);
    const wanted = crm.toLowerCase();
    const job = jobs.find((j) => String(j.crm).trim().toLowerCase() === wanted) || null;

    // Other parts of the same top-level job — useful context when a handover
    // is one of several splits (19289-1, 19289-2, ...).
    const base = baseCrm(crm);
    const siblings = jobs.filter((j) => {
      const c = String(j.crm).trim().toLowerCase();
      return baseCrm(c) === base && c !== wanted;
    });

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
        fileModified: lastModified,
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
