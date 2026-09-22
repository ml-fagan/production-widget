export const dynamic = "force-dynamic";

// Requests, in the handover app where every other record lives. Read by anyone
// signed in; raised by anyone; answered by a manager. The signed-in person's
// token rides along so a request has a name on it.

async function call(method, init) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/requests`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      cache: "no-store",
      ...init,
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

export async function GET() {
  return call("GET");
}

export async function POST(req) {
  const body = await req.text();
  return call("POST", { body });
}
