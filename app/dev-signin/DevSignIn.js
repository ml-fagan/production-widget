"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, signOut } from "firebase/auth";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";

/** Only this machine. See the note on the page that renders this. */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export default function DevSignIn() {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  /**
   * The hostname lock refuses to ACT rather than refusing to draw.
   *
   * A page that renders and then declines to do anything is a clearer
   * statement than a page that quietly isn't there — and the lock that
   * actually matters is on the page itself, which does not exist in a
   * production build at all.
   */
  const go = async () => {
    if (!LOCAL.has(window.location.hostname)) {
      setError("Developer sign-in only works on this machine.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await signInWithCustomToken(auth(), token.trim());
      window.location.href = "/timeline";
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const box = {
    width: "100%",
    border: "1px solid #e5e1d8",
    borderRadius: 8,
    padding: "9px 11px",
    fontSize: 12,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 32, color: "#1c1b19" }}>
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Developer sign-in</h1>
      <p style={{ fontSize: 13, color: "#6b6862", marginTop: 6, lineHeight: 1.6 }}>
        Local only, and never in a production build. Mint a token with{" "}
        <code>node scripts/dev-token.mjs &lt;email&gt;</code> in the handover app and paste it
        here. No password is involved, and nothing on this page can read one.
      </p>

      <p style={{ fontSize: 12.5, color: "#6b6862", marginTop: 14 }}>
        {user ? `Signed in as ${user.email}` : "Not signed in"}
      </p>

      <textarea
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Paste the custom token"
        rows={5}
        style={{ ...box, marginTop: 8, resize: "vertical", fontFamily: "monospace" }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          onClick={go}
          disabled={busy || !token.trim()}
          style={{
            border: "1px solid #1c1b19",
            background: busy ? "#6b6862" : "#1c1b19",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontFamily: "inherit",
            cursor: busy ? "default" : "pointer",
          }}
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <button
          type="button"
          onClick={() => signOut(auth())}
          style={{
            border: "1px solid #e5e1d8",
            background: "#fff",
            color: "#1c1b19",
            borderRadius: 8,
            padding: "8px 16px",
            fontSize: 13,
            fontFamily: "inherit",
            cursor: "pointer",
          }}
        >
          Sign out
        </button>
      </div>

      {error && <p style={{ fontSize: 12.5, color: "#a3312c", marginTop: 10 }}>{error}</p>}
    </main>
  );
}
