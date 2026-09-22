export const dynamic = "force-dynamic";

// The material list, from the handover app where it lives. Read by anyone in
// the feed; written only through here, with the signed-in person's token so
// the handover app can decide whether they're allowed to keep the list.

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
    const res = await fetch(`${base.replace(/\/$/, "")}/api/materials/list`, {
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
  // Passed through whole: what the list accepts is the handover app's rule,
  // and listing the fields here would be a second place to forget one.
  const body = await req.text();
  return call("POST", { body });
}
