export const dynamic = "force-dynamic";

// The finish and substrate lists, from the handover app.
//
// Served rather than copied: Alice adds stock here and Mitch orders it there,
// and the two have to offer the same words or the register stops matching the
// picking list. A pasted copy would drift the first time a finish was added to
// one of them.

export async function GET() {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/materials/options`, {
      headers: { Authorization: `Bearer ${secret}` },
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
