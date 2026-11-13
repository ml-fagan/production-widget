export const dynamic = "force-dynamic";

/**
 * Every project's history, from the handover app.
 *
 * The signed-in person's ID token goes with it, not just the shared secret,
 * and that is the whole security of this page. The secret says the request
 * came from the feed; it cannot say which of thirteen people is looking, and
 * the timeline puts the quote, the drawings, the approval, every purchase
 * order, every date and every invoice on one screen. So the handover app
 * checks the Timeline grant against the verified email, and a call without a
 * token gets nothing however it authenticated.
 *
 * A POST for a read, like the review queue: the token travels in the body
 * rather than in a query string, because a token in a query string ends up in
 * logs.
 */

const noStore = { "Cache-Control": "no-store" };

export async function POST(req) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: noStore }
    );
  }
  try {
    const body = await req.text();
    const res = await fetch(`${base.replace(/\/$/, "")}/api/timeline`, {
      method: "POST",
      cache: "no-store",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body,
    });
    const json = await res.json().catch(() => ({
      ok: false,
      error: `Handover app returned ${res.status}`,
    }));
    return Response.json(json, { status: res.ok ? 200 : res.status, headers: noStore });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err?.message || err) },
      { status: 502, headers: noStore }
    );
  }
}
