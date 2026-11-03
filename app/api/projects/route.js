export const dynamic = "force-dynamic";

// The projects board's own data: the plans, and who the project managers are.
//
// Reading is machine-to-machine like the other boards — the feed is already
// behind the staff password, and a plan holds less than the handover beside it
// does. Writing forwards the person's own token instead, because who may
// change a plan depends on who owns the project, and only the handover app can
// answer that.

const noStore = { "Cache-Control": "no-store" };

function fail(error, status = 503) {
  return Response.json({ ok: false, error }, { status, headers: noStore });
}

async function proxy(path, init) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) return fail("Handover app not configured.");
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      cache: "no-store",
      ...init,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    const json = await res.json().catch(() => ({
      ok: false,
      error: `Handover app returned ${res.status}`,
    }));
    return Response.json(json, { status: res.ok ? 200 : res.status, headers: noStore });
  } catch (err) {
    return fail(String(err?.message || err), 502);
  }
}

export async function GET() {
  return proxy("/api/projects/board");
}

/**
 * Set the needed-on-site date, the deadline adjustment, or who owns the job.
 *
 * The browser's ID token travels in the body, the way every other write from
 * this app does: the shared secret says the request came from the feed, and
 * the token says who is asking. The handover app checks both, and refuses a
 * plan that belongs to somebody else.
 */
export async function POST(req) {
  const body = await req.text();
  return proxy("/api/projects/plan", { method: "POST", body });
}
