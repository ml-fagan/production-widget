export const dynamic = "force-dynamic";

// Recording that the client has signed.
//
// Its own route rather than a mode on /api/projects, because it is its own
// act: it starts the clock every promise about the job is worked out from,
// and it writes the approval onto every handover under the project. Worth
// being able to find in a log by name.

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
    const res = await fetch(`${base.replace(/\/$/, "")}/api/projects/approve`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      cache: "no-store",
      body: await req.text(),
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
