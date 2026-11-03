export const dynamic = "force-dynamic";

// Releasing a held handover to Alice's board and Veronica's.
//
// Forwards the person's own token and nothing else. The shared secret is
// deliberately NOT sent: releasing is a judgement somebody signs their name
// to, and a request carrying only a machine secret has no name on it. The
// handover app refuses it for the same reason.

const noStore = { "Cache-Control": "no-store" };

export async function POST(req) {
  const base = process.env.HANDOVER_APP_URL;
  if (!base) {
    return Response.json(
      { ok: false, error: "Handover app not configured." },
      { status: 503, headers: noStore }
    );
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/handovers/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
