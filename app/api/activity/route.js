export const dynamic = "force-dynamic";

// The activity log, proxied. The handover app owns it, like everything else
// that touches Firestore — the feed holds no credentials of its own.
//
// Reads pass the signed-in person's ID token through when there is one, so a
// browser that isn't signed in is turned away by the same rule as everywhere
// else rather than by this file.

async function call(path, init) {
  const base = process.env.HANDOVER_APP_URL;
  const secret = process.env.JOB_API_SECRET;
  if (!base || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
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

export async function GET(req) {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const key = url.searchParams.get("key");
  const query = scope && key ? `?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}` : "";
  return call(`/api/activity${query}`, { method: "GET" });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return call("/api/activity", { method: "POST", body: JSON.stringify(body) });
}
