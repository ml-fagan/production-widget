"use client";

import { useState } from "react";
import { signInWithEmailAndPassword, signInWithPopup, signOut } from "firebase/auth";
import { auth, googleProvider, firebaseConfigured } from "../lib/firebaseClient.js";

/**
 * Who's making a change. The feed itself stays behind the shared staff
 * password — this only identifies the person, so an edit to the schedule or a
 * material order carries a name.
 *
 * Email and password, matching Decorflow: the team already has accounts and
 * shouldn't need a second identity. Google remains for anyone who's linked one.
 */
export default function SignIn({ user, brand }) {
  const B = brand || {
    card: "#ffffff",
    ink: "#1c1b19",
    sub: "#6b6862",
    line: "#e5e1d8",
    green: "#408152",
    blue: "#004CFB",
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!firebaseConfigured()) {
    return (
      <div style={{ marginBottom: 6, color: "#a86b12" }}>
        Sign-in not configured — changes can&apos;t be recorded.
      </div>
    );
  }

  const signIn = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth(), email.trim(), password);
      setOpen(false);
      setPassword("");
    } catch {
      setError("Incorrect email or password.");
    } finally {
      setBusy(false);
    }
  };

  const signInGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPopup(auth(), googleProvider);
      setOpen(false);
    } catch {
      setError("Google sign in failed.");
    } finally {
      setBusy(false);
    }
  };

  const field = {
    width: "100%",
    border: `1px solid ${B.line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <div style={{ marginBottom: 6 }}>
      {user ? (
        <>
          <span>{user.email}</span>{" "}
          <button
            onClick={() => signOut(auth())}
            style={{
              border: "none",
              background: "none",
              color: B.blue,
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            sign out
          </button>
        </>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            border: `1px solid ${B.line}`,
            background: B.card,
            color: B.ink,
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Sign in to make changes
        </button>
      ) : (
        <form
          onSubmit={signIn}
          style={{
            background: B.card,
            border: `1px solid ${B.line}`,
            borderRadius: 10,
            padding: 12,
            width: 240,
            textAlign: "left",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>Use your Decorflow login</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@decorsystems.com.au"
            autoComplete="username"
            style={{ ...field, marginBottom: 6 }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            style={field}
          />
          <button
            type="submit"
            disabled={busy || !email || !password}
            style={{
              ...field,
              border: "none",
              background: B.green,
              color: "#fff",
              cursor: "pointer",
              marginTop: 8,
              opacity: busy || !email || !password ? 0.6 : 1,
            }}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
          <button
            type="button"
            onClick={signInGoogle}
            disabled={busy}
            style={{
              ...field,
              background: "transparent",
              color: B.sub,
              fontSize: 12,
              cursor: "pointer",
              marginTop: 6,
            }}
          >
            Continue with Google
          </button>
          {error && (
            <div style={{ color: "#a3312c", fontSize: 12, marginTop: 6 }}>{error}</div>
          )}
        </form>
      )}
    </div>
  );
}
