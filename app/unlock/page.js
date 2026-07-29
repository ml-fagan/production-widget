"use client";

import { useState } from "react";

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  blue: "#004CFB",
  red: "#a3312c",
};

export default function Unlock() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "Incorrect password");
        setBusy(false);
        return;
      }
      window.location.href = "/";
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <form
        onSubmit={submit}
        style={{
          background: BRAND.card,
          border: `1px solid ${BRAND.line}`,
          borderRadius: 14,
          padding: "32px 28px",
          width: "100%",
          maxWidth: 360,
        }}
      >
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: BRAND.blue,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div style={{ width: 20, height: 3, background: "#f5f3ef", boxShadow: "0 6px 0 #f5f3ef, 0 -6px 0 #408152" }} />
        </div>
        <h1 style={{ fontSize: 19, fontWeight: 600, margin: "0 0 4px" }}>Production Feed</h1>
        <p style={{ fontSize: 13, color: BRAND.sub, margin: "0 0 22px" }}>
          Decor Systems staff only. Enter the shared password to continue.
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          style={{
            width: "100%",
            boxSizing: "border-box",
            border: `1px solid ${error ? BRAND.red : BRAND.line}`,
            borderRadius: 8,
            padding: "11px 12px",
            fontSize: 14,
            fontFamily: "inherit",
            color: BRAND.ink,
            outline: "none",
            marginBottom: 12,
          }}
        />

        {error && (
          <p style={{ color: BRAND.red, fontSize: 13, margin: "0 0 12px" }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          style={{
            width: "100%",
            border: "none",
            background: busy || !password ? "#9db3f0" : BRAND.blue,
            color: "#fff",
            borderRadius: 8,
            padding: "11px 12px",
            fontSize: 14,
            fontWeight: 500,
            cursor: busy || !password ? "default" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
