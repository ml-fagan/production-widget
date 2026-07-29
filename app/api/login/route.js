import { makeToken, COOKIE_NAME } from "../../../lib/auth.js";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const secret = process.env.FEED_PASSWORD;
  if (!secret) {
    return Response.json({ ok: true, note: "No password set; access is open." });
  }

  let password = "";
  try {
    const body = await req.json();
    password = body?.password ?? "";
  } catch {
    return Response.json({ ok: false, error: "Bad request" }, { status: 400 });
  }

  // Length-independent comparison of the submitted password.
  const a = new TextEncoder().encode(password);
  const b = new TextEncoder().encode(secret);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  if (diff !== 0) {
    return Response.json({ ok: false, error: "Incorrect password" }, { status: 401 });
  }

  const token = await makeToken(secret);
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`
  );
  return res;
}
