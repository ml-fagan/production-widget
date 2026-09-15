export const dynamic = "force-dynamic";

// What the signed-in person may change, from the handover app — which is where
// the write endpoints live, so it's the only place that can answer honestly.

export async function POST(req) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: true, email: null, can: { materials: true, invoicing: true } },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const body = await req.text();
    const res = await fetch(`${base.replace(/\/$/, "")}/api/me`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    const json = await res.json().catch(() => null);
    if (!json) throw new Error(`Handover app returned ${res.status}`);
    return Response.json(json, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Can't tell — assume they may, and let the write endpoint refuse if not.
    // Locking a board on a network blip would be the worse failure.
    return Response.json(
      { ok: true, email: null, can: { materials: true, invoicing: true } },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
