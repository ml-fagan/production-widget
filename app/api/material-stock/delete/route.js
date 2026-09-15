export const dynamic = "force-dynamic";

// Removes stock entries from the register, by passing the ids on to the
// handover app — the record lives there, not here. For an entry typed wrong,
// which was never true and so isn't worth keeping in the history. Behind the
// staff password like the rest of the feed; the shared secret is added
// server-side, and the signed-in person's token rides along so the deletion is
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
    const res = await fetch(`${base.replace(/\/$/, "")}/api/material-stock/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      // Passed through whole rather than rebuilt field by field: listing
      // them here meant every new field had to be remembered in two places,
      // and twice it wasn't. The handover app whitelists what it accepts.
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
