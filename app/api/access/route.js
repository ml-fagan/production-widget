export const dynamic = "force-dynamic";

// Who has access to what.
//
// The only route in the feed that does NOT add the shared secret. Everywhere
// else the secret says "this request came from the feed" and the handover app
// decides the rest from the signed-in person's token. Here the secret would
// say too much: the handover app lets machine callers read, because that's how
// the boards read each other, and a list of everybody's access behind nothing
// but the staff password is exactly the list you'd read before deciding what
// to take off somebody.
//
// So this one forwards the person's own token and nothing else. No token, no
// answer — and the handover app still checks they hold `admin`.

function auth(req) {
  const header = req.headers.get("authorization") || "";
  return header.startsWith("Bearer ") && header.length > 12 ? header : null;
}

async function call(method, token, init) {
  const base = process.env.HANDOVER_APP_URL;
  if (!base) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/access`, {
      method,
      headers: { Authorization: token, "Content-Type": "application/json" },
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
  const token = auth(req);
  if (!token) {
    return Response.json(
      { ok: false, error: "sign_in_required" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );
  }
  return call("GET", token);
}

export async function POST(req) {
  // A write needs the machine secret as well, because the handover app's POST
  // is machine-gated like every other write in the system — and the person's
  // token travels in the body, as it does everywhere else.
  const secret = process.env.JOB_API_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
  const body = await req.text();
  return call("POST", `Bearer ${secret}`, { body });
}
