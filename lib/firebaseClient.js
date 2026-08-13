// Browser-side Firebase, used only to identify who is ticking material orders.
//
// The feed itself stays behind the shared staff password — this doesn't gate
// the page, it just answers "who clicked?". The handover app verifies the ID
// token server-side before recording a name, so a signed-in session here is a
// claim that has to survive checking, not something we trust on its own.

import { initializeApp, getApps } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export function firebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

function app() {
  return getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
}

export function auth() {
  return getAuth(app());
}

export const googleProvider = new GoogleAuthProvider();
