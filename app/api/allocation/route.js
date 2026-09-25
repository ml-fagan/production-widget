export const dynamic = "force-dynamic";

// Who's on which machine, from the handover app where the record lives.
//
// The GET carries no identity on purpose: the wall display in the factory has
// nobody logged into it. It's still behind the staff password like the rest of
// the feed — the screen is unlocked once and stays that way — and the handover
// app returns a day and no way to change it. Writes carry the signed-in
// person's token, because staffing the day has a name on it.

function base() {
  return { url: process.env.HANDOVER_APP_URL, secret: process.env.JOB_API_SECRET };
}

async function call(path, init) {
  const { url, secret } = base();
  if (!url || !secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/allocation${path}`, {
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
  // Only the day range travels; anything else a caller invents is dropped here
  // rather than forwarded.
  const params = new URLSearchParams();
  for (const key of ["date", "from", "to"]) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return call(query ? `?${query}` : "");
}

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  return call("", {
    method: "POST",
    body: JSON.stringify({ ...body, idToken: body.idToken || null }),
  });
}
