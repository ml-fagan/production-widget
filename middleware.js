import { NextResponse } from "next/server";
import { verifyToken, COOKIE_NAME } from "./lib/auth.js";

// Gate everything except the unlock page, the login API, and static assets.
const PUBLIC_PATHS = ["/unlock", "/api/login"];
const PUBLIC_PREFIXES = ["/_next", "/icon", "/manifest", "/apple", "/favicon"];

// Machine-to-machine routes: authorised by a shared bearer secret instead of
// the staff password cookie, so another app (the handover form) can ask for a
// single job without a human unlocking anything. Never public — a wrong or
// missing header falls through to the normal cookie check, which 401s.
const MACHINE_PREFIXES = ["/api/job"];

function machineAuthorised(req) {
  const expected = process.env.JOB_API_SECRET || "";
  if (!expected) return false;
  const header = req.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next();
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (MACHINE_PREFIXES.some((p) => pathname.startsWith(p)) && machineAuthorised(req)) {
    return NextResponse.next();
  }

  const secret = process.env.FEED_PASSWORD;
  // If no password is configured, don't lock anyone out — fail open with a
  // clear console note rather than bricking the deploy.
  if (!secret) return NextResponse.next();

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const ok = await verifyToken(token, secret);
  if (ok) return NextResponse.next();

  // API calls get a 401; page navigations get redirected to the unlock screen.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
