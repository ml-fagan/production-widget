import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";
import { fetchLoggedHandovers, splitByScheduled } from "../../../lib/handovers.js";
import { tokenForCrm } from "../../../lib/token.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Handovers Mitch has logged, split by whether the schedule has caught up yet.
// "awaiting" is Duncan's queue: jobs that exist and need a date. Nothing here
// is a to-do list anyone has to tick off — a job leaves the queue the moment a
// row for it appears in the spreadsheet.
//
// Behind the staff password like the rest of the feed: this is internal data,
// and the browser calling it is already unlocked.

const TRACKER_BASE = process.env.TRACKER_BASE_URL || "";

export async function GET() {
  try {
    const handovers = await fetchLoggedHandovers();

    // The schedule is only needed to work out what's already scheduled. If it
    // can't be read, still return the handovers rather than nothing — an
    // unsplit queue beats an empty screen.
    let jobs = [];
    let scheduleError = null;
    try {
      const { buffer } = await downloadScheduleBuffer();
      jobs = parseSchedule(buffer).jobs;
    } catch (err) {
      scheduleError = String(err.message || err);
    }

    // The client link is built here, not in the browser: the token is an HMAC
    // and LINK_SECRET must stay server-side. Same token as a spreadsheet job
    // would get, so a job scheduled on the board shares one link with any of
    // its parts that came off the sheet.
    const withLinks = handovers.map((h) => ({
      ...h,
      clientLink: TRACKER_BASE
        ? `${TRACKER_BASE.replace(/\/$/, "")}/p/${tokenForCrm(h.jobId)}`
        : null,
    }));

    const { awaiting, scheduled } = splitByScheduled(withLinks, jobs);
    return Response.json(
      {
        ok: true,
        awaiting,
        scheduled,
        scheduleError,
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
