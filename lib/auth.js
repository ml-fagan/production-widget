// Signed-cookie helpers using Web Crypto (HMAC-SHA256), so they run in both
// the Edge middleware and Node route handlers. The cookie holds a signed
// marker, not the password itself — the password never leaves the server.

const encoder = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// A fixed payload is fine: possession of a valid signature = knew the password.
const PAYLOAD = "decor-production-feed-ok";

export async function makeToken(secret) {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(PAYLOAD));
  return `${PAYLOAD}.${toHex(sig)}`;
}

export async function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const [payload, sigHex] = token.split(".");
  if (payload !== PAYLOAD || !sigHex) return false;
  const expected = await makeToken(secret);
  // constant-time-ish compare
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export const COOKIE_NAME = "df_auth";
