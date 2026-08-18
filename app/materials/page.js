"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";

// Material orders board.
//
// Every handed-over job with its material list, so Alice can see what needs
// ordering without opening each record. Two steps, because they answer
// different questions: ordered means it's on its way, arrived means the job can
// actually start. Duncan reads the same two states as the MATERIALS cell on the
// schedule board — amber, then green.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  blue: "#004CFB",
};

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

const VIEWS = [
  { key: "not_ordered", label: "To order" },
  { key: "ordered", label: "Ordered" },
  { key: "arrived", label: "Arrived" },
];

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

export default function MaterialsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  // Kept apart from `error`: a failed click and a failed page load are
  // different problems and shouldn't be concatenated into one sentence.
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("not_ordered");
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState({});
  // What the server actually stored, adopted after each write so the name and
  // time on screen are its answer rather than our guess.
  const [stored, setStored] = useState({});

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

  const orderOf = (h) => stored[h.jobId] ?? h.materialOrder ?? {};
  const stateOf = (h) => orderOf(h).state || "not_ordered";

  const setState = useCallback(async (jobId, state) => {
    // Claiming an order is placed or delivered is attributable; clearing it
    // only withdraws a claim, so that doesn't need a name.
    let idToken = null;
    if (state !== "not_ordered") {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      idToken = await current.getIdToken();
    }

    setPending((p) => ({ ...p, [jobId]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/material-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, state, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setStored((s) => ({ ...s, [jobId]: json.materialOrder }));
    } catch (e) {
      setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [jobId]: false }));
    }
  }, []);

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

  const counts = {
    not_ordered: matching.filter((h) => stateOf(h) === "not_ordered").length,
    ordered: matching.filter((h) => stateOf(h) === "ordered").length,
    arrived: matching.filter((h) => stateOf(h) === "arrived").length,
  };
  const jobs = matching.filter((h) => stateOf(h) === view);
  const lineCount = jobs.reduce((n, h) => n + (h.materials?.length || 0), 0);

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "5px 12px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };

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
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"} · {lineCount}{" "}
              material lines
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div style={{ marginTop: 6 }}>
              {data?.fetchedAt ? `Updated ${fmtTime(data.fetchedAt)}` : ""}
            </div>
          </div>
        </header>

        <Tabs current="materials" counts={{ materials: counts.not_ordered }} />

        <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                ...btn,
                background: view === v.key ? BRAND.ink : BRAND.card,
                color: view === v.key ? "#fff" : BRAND.sub,
                fontSize: 13,
              }}
            >
              {v.label} ({counts[v.key]})
            </button>
          ))}
        </div>

        {actionError && (
          <div
            style={{
              background: "#fdf4e6",
              border: `1px solid ${BRAND.amber}`,
              color: BRAND.amber,
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
          placeholder="Filter by job, project or material"
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
              ? "Nothing handed over yet."
              : q
                ? "Nothing matches that filter."
                : view === "not_ordered"
                  ? "Everything's been ordered."
                  : "Nothing here yet."}
          </p>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {jobs.map((h) => {
            const state = stateOf(h);
            const order = orderOf(h);
            const busy = pending[h.jobId];
            return (
              <section
                key={h.jobId}
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.line}`,
                  borderLeft: `3px solid ${
                    state === "arrived"
                      ? BRAND.green
                      : state === "ordered"
                        ? BRAND.amber
                        : BRAND.line
                  }`,
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
                    marginBottom: 8,
                  }}
                >
                  <a
                    href={`${HANDOVER_APP}/${encodeURIComponent(h.jobId)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      color: BRAND.blue,
                      textDecoration: "none",
                    }}
                  >
                    {h.jobId}
                  </a>
                  <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                  <span style={{ fontSize: 12, color: BRAND.sub }}>
                    {h.totalSheets ? `${h.totalSheets} sheets` : ""}
                    {h.totalSheets && h.totalM2 ? " · " : ""}
                    {h.totalM2 ? `${h.totalM2} m²` : ""}
                  </span>

                  <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    {state === "not_ordered" && (
                      <button
                        onClick={() => setState(h.jobId, "ordered")}
                        disabled={busy}
                        style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                      >
                        Mark ordered
                      </button>
                    )}
                    {state === "ordered" && (
                      <>
                        <button
                          onClick={() => setState(h.jobId, "arrived")}
                          disabled={busy}
                          style={{
                            ...btn,
                            background: BRAND.green,
                            borderColor: BRAND.green,
                            color: "#fff",
                            opacity: busy ? 0.6 : 1,
                          }}
                        >
                          Mark arrived
                        </button>
                        <button
                          onClick={() => setState(h.jobId, "not_ordered")}
                          disabled={busy}
                          style={{ ...btn, color: BRAND.sub }}
                          title="Undo — puts this back on the to-order list"
                        >
                          Undo
                        </button>
                      </>
                    )}
                    {state === "arrived" && (
                      <button
                        onClick={() => setState(h.jobId, "ordered")}
                        disabled={busy}
                        style={{ ...btn, color: BRAND.sub }}
                        title="Back to ordered"
                      >
                        ✓ Arrived
                      </button>
                    )}
                  </span>
                </div>

                {(order.orderedAt || order.arrivedAt) && (
                  <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 10px" }}>
                    {order.orderedAt &&
                      `Ordered by ${order.orderedBy || "unknown"} · ${fmtStamp(order.orderedAt)}`}
                    {order.orderedAt && order.arrivedAt && "  ·  "}
                    {order.arrivedAt &&
                      `Arrived ${fmtStamp(order.arrivedAt)}${
                        order.arrivedBy ? ` · confirmed by ${order.arrivedBy}` : ""
                      }`}
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
            );
          })}
        </div>
      </div>
    </main>
  );
}
