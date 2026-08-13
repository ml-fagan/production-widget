"use client";

import { useCallback, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import Tabs from "../Tabs.js";
import { auth, googleProvider, firebaseConfigured } from "../../lib/firebaseClient.js";

// Material orders board.
//
// Every logged handover with its material list, so Alice can see what needs
// ordering without opening each record — job, project, and the lines Mitch
// listed. Read-only: the handover stays the source of truth, and ordering is
// still tracked wherever Alice tracks it (Asana), not ticked off here.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  blue: "#004CFB",
};

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
}

// Who's ticking. Deliberately small and out of the way: everyone can read this
// board on the shared password, only a signed-in person can mark an order.
function SignIn({ user }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (!firebaseConfigured()) {
    return (
      <div style={{ marginBottom: 6, color: "#a86b12" }}>
        Sign-in not configured — ordering can&apos;t be recorded.
      </div>
    );
  }

  // Email and password, matching Decorflow — the team already has accounts.
  // Google stays available for anyone who has linked one to their work address.
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
              color: BRAND.blue,
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
            border: `1px solid ${BRAND.line}`,
            background: BRAND.card,
            color: BRAND.ink,
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Sign in to mark orders
        </button>
      ) : (
        <form
          onSubmit={signIn}
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            padding: 12,
            width: 240,
            textAlign: "left",
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 12 }}>
            Use your Decorflow login
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@decorsystems.com.au"
            autoComplete="username"
            style={{
              width: "100%",
              border: `1px solid ${BRAND.line}`,
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              marginBottom: 6,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            style={{
              width: "100%",
              border: `1px solid ${BRAND.line}`,
              borderRadius: 8,
              padding: "7px 10px",
              fontSize: 13,
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
          <button
            type="submit"
            disabled={busy || !email || !password}
            style={{
              width: "100%",
              border: "none",
              background: BRAND.green,
              color: "#fff",
              borderRadius: 8,
              padding: "7px 0",
              fontSize: 13,
              cursor: "pointer",
              marginTop: 8,
              fontFamily: "inherit",
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
              width: "100%",
              border: `1px solid ${BRAND.line}`,
              background: "transparent",
              color: BRAND.sub,
              borderRadius: 8,
              padding: "6px 0",
              fontSize: 12,
              cursor: "pointer",
              marginTop: 6,
              fontFamily: "inherit",
            }}
          >
            Continue with Google
          </button>
        </form>
      )}
      {error && <div style={{ color: "#a3312c" }}>{error}</div>}
    </div>
  );
}

export default function MaterialsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [overrides, setOverrides] = useState({});
  const [pending, setPending] = useState({});
  const [showDone, setShowDone] = useState(false);
  const [user, setUser] = useState(null);
  const [stamps, setStamps] = useState({});
  // Kept apart from `error`: a failed tick and a failed page load are different
  // problems and shouldn't be concatenated into one sentence.
  const [actionError, setActionError] = useState(null);

  // Identifies who ticks an order. Doesn't gate the page — the shared staff
  // password still does that.
  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load handovers");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  // Optimistic: the tick flips immediately and the row moves, then the write
  // goes to the handover app. On failure it flips back with a message rather
  // than quietly disagreeing with what's stored.
  const setActioned = useCallback(
    async (jobId, actioned) => {
      // Marking done is attributable, so it needs a signed-in person. The token
      // is verified by the handover app; the name is never sent as plain text.
      let idToken = null;
      if (actioned) {
        const current = firebaseConfigured() ? auth().currentUser : null;
        if (!current) {
          setActionError(
            "Sign in first so the order is recorded against your name."
          );
          return;
        }
        idToken = await current.getIdToken();
      }

      setPending((p) => ({ ...p, [jobId]: true }));
      setOverrides((o) => ({ ...o, [jobId]: actioned }));
      setActionError(null);
      try {
        const res = await fetch("/api/material-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, actioned, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Update failed");
        // Adopt what was actually stored, so the name and time on screen are
        // the server's, not a guess.
        setStamps((s) => ({ ...s, [jobId]: json.materialOrder }));
      } catch (e) {
        setOverrides((o) => ({ ...o, [jobId]: !actioned }));
        setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
      } finally {
        setPending((p) => ({ ...p, [jobId]: false }));
      }
    },
    []
  );

  const isActioned = (h) =>
    overrides[h.jobId] ?? Boolean(h.materialOrder?.actioned);

  const orderStamp = (h) => stamps[h.jobId] ?? h.materialOrder;

  const all = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])];
  const q = query.trim().toLowerCase();
  const matching = q
    ? all.filter((h) =>
        [h.jobId, h.project, h.client, ...(h.materials || []).map((m) => m.name)]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : all;

  const outstanding = matching.filter((h) => !isActioned(h));
  const done = matching.filter(isActioned);
  const jobs = showDone ? done : outstanding;

  const lineCount = jobs.reduce((n, h) => n + (h.materials?.length || 0), 0);

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        padding: "24px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 20,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Material orders
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {showDone ? "Already ordered" : "To order"} · {jobs.length}{" "}
              {jobs.length === 1 ? "handover" : "handovers"} · {lineCount} material
              lines
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} />
            <button
              onClick={load}
              style={{
                border: `1px solid ${BRAND.line}`,
                background: BRAND.card,
                color: BRAND.ink,
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div style={{ marginTop: 6 }}>
              {data?.fetchedAt ? `Updated ${fmtTime(data.fetchedAt)}` : ""}
            </div>
          </div>
        </header>

        <Tabs
          current="materials"
          counts={{
            awaiting: (data?.awaiting ?? []).length,
            materials: all.filter((h) => !isActioned(h)).length,
          }}
        />

        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {[
            { key: false, label: `To order (${outstanding.length})` },
            { key: true, label: `Ordered (${done.length})` },
          ].map((opt) => (
            <button
              key={String(opt.key)}
              onClick={() => setShowDone(opt.key)}
              style={{
                border: `1px solid ${BRAND.line}`,
                background: showDone === opt.key ? BRAND.ink : BRAND.card,
                color: showDone === opt.key ? "#fff" : BRAND.sub,
                borderRadius: 8,
                padding: "5px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {actionError && (
          <div
            style={{
              background: "#fdf4e6",
              border: "1px solid #a86b12",
              color: "#a86b12",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            {actionError}
          </div>
        )}

        {error && (
          <div
            style={{
              background: "#fbeceb",
              border: "1px solid #a3312c",
              color: "#a3312c",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load handovers. {error}
          </div>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by CRM, project or material"
          style={{
            width: "100%",
            border: `1px solid ${BRAND.line}`,
            background: BRAND.card,
            borderRadius: 8,
            padding: "8px 12px",
            fontSize: 14,
            fontFamily: "inherit",
            marginBottom: 16,
            boxSizing: "border-box",
          }}
        />

        {!loading && jobs.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "No handovers logged yet."
              : q
                ? "Nothing matches that filter."
                : showDone
                  ? "Nothing marked as ordered yet."
                  : "Everything's been ordered."}
          </p>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {jobs.map((h) => (
            <section
              key={h.jobId}
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  flexWrap: "wrap",
                  marginBottom: 10,
                }}
              >
                <a
                  href={`${HANDOVER_APP}/${encodeURIComponent(h.jobId)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontWeight: 600, fontSize: 14, color: BRAND.blue, textDecoration: "none" }}
                >
                  {h.jobId}
                </a>
                <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                  {h.totalSheets ? `${h.totalSheets} sheets` : ""}
                  {h.totalSheets && h.totalM2 ? " · " : ""}
                  {h.totalM2 ? `${h.totalM2} m²` : ""}
                </span>
                <button
                  onClick={() => setActioned(h.jobId, !isActioned(h))}
                  disabled={pending[h.jobId]}
                  style={{
                    border: `1px solid ${isActioned(h) ? BRAND.green : BRAND.line}`,
                    background: isActioned(h) ? BRAND.green : BRAND.card,
                    color: isActioned(h) ? "#fff" : BRAND.ink,
                    borderRadius: 8,
                    padding: "5px 12px",
                    fontSize: 12,
                    cursor: pending[h.jobId] ? "default" : "pointer",
                    opacity: pending[h.jobId] ? 0.6 : 1,
                    fontFamily: "inherit",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isActioned(h) ? "✓ Ordered" : "Mark ordered"}
                </button>
              </div>

              {isActioned(h) && orderStamp(h)?.actionedAt && (
                <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 10px" }}>
                  Ordered by {orderStamp(h).actionedBy || "unknown"} ·{" "}
                  {fmtStamp(orderStamp(h).actionedAt)}
                </p>
              )}

              {h.materials?.length ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: BRAND.sub }}>
                      <th style={{ fontWeight: 500, padding: "2px 0" }}>Material</th>
                      <th style={{ fontWeight: 500, width: 140 }}>Quantity</th>
                      <th style={{ fontWeight: 500, width: 180 }}>Supplier / stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.materials.map((m, i) => (
                      <tr key={i} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                        <td style={{ padding: "6px 0" }}>{m.name || "—"}</td>
                        <td>{m.quantity || "—"}</td>
                        <td style={{ color: BRAND.sub }}>{m.supplier || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: 13, color: BRAND.sub, margin: 0 }}>
                  No materials listed on this handover yet.
                </p>
              )}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
