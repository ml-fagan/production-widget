import { downloadScheduleBuffer } from "../../../lib/graph.js";
import { parseSchedule } from "../../../lib/parseSchedule.js";
import { fetchLoggedHandovers, splitByScheduled } from "../../../lib/handovers.js";
import { tokenForCrm } from "../../../lib/token.js";
import {
  fetchProductionTasks,
  buildAsanaLookup,
  checkAgainstAsana,
} from "../../../lib/asana.js";

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

export async function GET(req) {
  // The Asana cross-check is only worth its round trip on the page that shows
  // it, and this route feeds five. The production schedule asks for it; the
  // ordering and stock boards don't, and shouldn't wait on Asana to load.
  const wantsAsana = new URL(req.url).searchParams.get("asana") === "1";
  try {
    const handovers = await fetchLoggedHandovers();

    // Jobs dated on the board never had this: the check lived in the schedule
    // route, which only ever sees the spreadsheet, so a board job showed a
    // blank where every other row showed a tick. Same lookup, same rule —
    // Asana's due date against the date the job is committed to.
    const asana = wantsAsana
      ? await fetchProductionTasks()
          .then((tasks) => ({ lookup: buildAsanaLookup(tasks) }))
          // A cross-check, not the source of truth: the queue still answers if
          // Asana is unreachable or ASANA_TOKEN isn't set.
          .catch((err) => ({ lookup: null, error: String(err.message || err) }))
      : null;

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
      asanaCheck: !asana
        ? null
        : asana.lookup
          ? checkAgainstAsana(
              {
                crm: h.jobId,
                // What the row shows as Dispatch: the date it actually went,
                // or the date it's committed to until then.
                dispatch: h.schedule?.actualDate || h.schedule?.committedDate || null,
              },
              asana.lookup
            )
          : { status: "warn", reason: "asana_unavailable", error: asana.error },
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
