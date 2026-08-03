import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";
import { tokenForCrm } from "../../../lib/token.js";
import { fetchProductionTasks, buildAsanaLookup, checkAgainstAsana } from "../../../lib/asana.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Base URL of the client tracker (e.g. https://client-tracker-mu-dusky.vercel.app
// now, or https://track.decorsystems.com.au once the domain is added).
const TRACKER_BASE = process.env.TRACKER_BASE_URL || "";

export async function GET() {
  try {
    const [{ buffer, lastModified }, asanaResult] = await Promise.all([
      downloadScheduleBuffer(),
      fetchProductionTasks()
        .then((tasks) => ({ lookup: buildAsanaLookup(tasks) }))
        // Asana is a cross-check, not the source of truth — don't take the
        // whole schedule down if it's unreachable or ASANA_TOKEN isn't set yet.
        .catch((err) => ({ lookup: null, error: String(err.message || err) })),
    ]);
    const { jobs, avgLead } = parseSchedule(buffer);
    const withLinks = jobs.map((j) => ({
      ...j,
      clientLink: TRACKER_BASE
        ? `${TRACKER_BASE.replace(/\/$/, "")}/p/${tokenForCrm(j.crm)}`
        : null,
      asanaCheck: asanaResult.lookup
        ? checkAgainstAsana(j, asanaResult.lookup)
        : { status: "warn", reason: "asana_unavailable", error: asanaResult.error },
    }));
    return Response.json(
      {
        ok: true,
        jobs: withLinks,
        avgLead,
        fileModified: lastModified,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err.message || err) },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
