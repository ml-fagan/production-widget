export const dynamic = "force-dynamic";

// What's on the rack and what's already spoken for, from the handover app.
//
// The reservation rule — which open jobs have ticked a material as coming
// from stock — lives there, next to the handovers it reads. Working it out
// again here would be a second answer to the same question, and the two would
// disagree the first time either changed.

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
    const res = await fetch(`${base.replace(/\/$/, "")}/api/material-stock/available`, {
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
