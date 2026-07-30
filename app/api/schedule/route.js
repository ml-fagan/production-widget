import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";
import { tokenForCrm } from "../../../lib/token.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Base URL of the client tracker (e.g. https://client-tracker-mu-dusky.vercel.app
// now, or https://track.decorsystems.com.au once the domain is added).
const TRACKER_BASE = process.env.TRACKER_BASE_URL || "";

export async function GET() {
  try {
    const { buffer, lastModified } = await downloadScheduleBuffer();
    const { jobs, avgLead } = parseSchedule(buffer);
    const withLinks = jobs.map((j) => ({
      ...j,
      clientLink: TRACKER_BASE
        ? `${TRACKER_BASE.replace(/\/$/, "")}/p/${tokenForCrm(j.crm)}`
        : null,
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
