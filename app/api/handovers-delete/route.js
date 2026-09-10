export const dynamic = "force-dynamic";

// Deletes a completed job, by passing the request on to the handover app where
// the record lives. The whole job goes — every board, and its client link — so
// the handover app only allows it for a job already marked complete. The
// signed-in person's token rides along so the deletion is attributable.

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
    const res = await fetch(`${base.replace(/\/$/, "")}/api/handovers/delete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jobId: body.jobId,
        idToken: body.idToken || null,
      }),
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
