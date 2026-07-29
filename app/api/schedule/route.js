import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";

// Always read fresh from SharePoint; never cache at the framework level.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const { buffer, lastModified } = await downloadScheduleBuffer();
    const { jobs, avgLead } = parseSchedule(buffer);
    return Response.json(
      {
        ok: true,
        jobs,
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
