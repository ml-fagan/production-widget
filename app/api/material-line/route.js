export const dynamic = "force-dynamic";

// Passes one material line's progress to the handover app, where the record
// lives. The shared secret is added server-side so it never reaches the
// browser; the signed-in person's token rides along so the change is
// attributable.

export async function POST(req) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/handovers/material-line`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      // Passed through whole rather than rebuilt field by field. Listing the
      // fields here meant every new one had to be remembered in two places,
      // and twice now it wasn't: first `state`, then `receivedQty`, each
      // silently dropped in transit so the write looked fine and saved
      // nothing. The handover app whitelists what it accepts, which is where
      // that belongs.
      body: JSON.stringify({ ...body, idToken: body.idToken || null }),
      cache: "no-store",
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
