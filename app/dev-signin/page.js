import { notFound } from "next/navigation";
import DevSignIn from "./DevSignIn.js";

/**
 * Exchanges a custom token for a session, on the local dev server only.
 *
 * Every board here is behind a sign-in, which means a screen can be built and
 * shipped without anybody having looked at it signed in as a real person.
 * This is how it gets looked at: `node scripts/dev-token.mjs <email>` in the
 * handover app mints a token with the Admin SDK, and this page hands it to
 * Firebase. No password is involved at any point, and nothing here can read
 * one.
 *
 * The same two locks the handover app's copy has, because a page that signs
 * people in deserves two:
 *
 *   • this one, which removes the route from any production build —
 *     NODE_ENV is "production" for `next build`, so on Vercel the path is a
 *     404 and the component below is never reachable;
 *   • a hostname check inside the component, so even a development build
 *     served from somewhere other than this machine refuses to act.
 *
 * It is not a way past anything. Minting the token needs
 * FIREBASE_PRIVATE_KEY, which already has more authority over this project
 * than any person does — somebody holding that does not need this page. What
 * it is, is a real session as a real colleague, and whatever is done in it is
 * done under their name.
 */
export default function DevSignInPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevSignIn />;
}
