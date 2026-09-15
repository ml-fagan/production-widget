export const dynamic = "force-dynamic";

// A pre-order landing. The handover app splits it between the jobs that
// claimed it and the shelf, in one batch — the arithmetic and the writes both
// live next to the handovers they touch.

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
    const body = await req.text();
    const res = await fetch(`${base.replace(/\/$/, "")}/api/pre-orders/arrive`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body,
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
