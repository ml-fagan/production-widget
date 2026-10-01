export const dynamic = "force-dynamic";

// Recording a chase, proxied.
//
// The Asana token never leaves the handover app, so the feed forwards with the
// shared secret and the person's own ID token travels in the body — the same
// shape every other write in this system takes.

export async function POST(req) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/drafting/chased`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: await req.text(),
    });
    const json = await res.json().catch(() => ({
      ok: false,
      error: `Handover app returned ${res.status}`,
    }));
    return Response.json(json, {
      status: res.ok ? 200 : res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err.message || err) },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}
