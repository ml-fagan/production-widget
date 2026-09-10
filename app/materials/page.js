"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { confirmAndDeleteJob, deleteLinkStyle } from "../deleteJob.js";

// Material orders board.
//
// Alice works line by line, not job by job: one job can need three materials
// from three suppliers landing weeks apart. Each line moves to order → ordered
// → completed and carries the date she expects it, which is what Duncan
// schedules against. A job is only "in" when every line is.
//
// Purely procurement status — ordered it, delivered it? Where a material
// physically is (stock, pre-orders, what stage a job's at) lives on the
// Stock page instead.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  blue: "#004CFB",
  red: "#a3312c",
};

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

const VIEWS = [
  { key: "outstanding", label: "Outstanding" },
  { key: "complete", label: "All in — completed orders" },
];

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

// Stock skips ordering but still gets confirmed — "we have stock" at handover
// isn't the same as someone having looked on the floor.
function effectiveState(m) {
  return m.state || "to_order";
}

function size(m) {
  if (!m.length || !m.width) return "—";
  return `${m.length} × ${m.width}${m.thickness ? ` × ${m.thickness}` : ""}`;
}

export default function MaterialsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("outstanding");
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState({});
  // What the server stored, adopted after each write so what's on screen is
  // its answer rather than our guess.
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

  const linesFor = (h) => stored[h.jobId] ?? h.materials ?? [];

  const setLine = useCallback(async (jobId, lineId, patch) => {
    // Claiming a line is ordered or in needs a name against it. Clearing one
    // back to "to order" only withdraws a claim.
    let idToken = null;
    const claiming = patch.state === "ordered" || patch.state === "completed";
    if (claiming) {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      idToken = await current.getIdToken();
    } else if (firebaseConfigured() && auth().currentUser) {
      idToken = await auth().currentUser.getIdToken();
    }

    const key = `${jobId}:${lineId}`;
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/material-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, lineId, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setStored((s) => ({ ...s, [jobId]: json.materials }));
    } catch (e) {
      setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, []);

  // Removing a job takes it off every board at once, so the list here has to
  // drop it too rather than wait for the next refresh.
  const deleteJob = async (row) => {
    const result = await confirmAndDeleteJob(row);
    if (result.cancelled) return;
    if (result.error) {
      setActionError(result.error);
      return;
    }
    setActionError(null);
    setData((d) =>
      d
        ? {
            ...d,
            awaiting: (d.awaiting || []).filter((h) => h.jobId !== row.jobId),
            scheduled: (d.scheduled || []).filter((h) => h.jobId !== row.jobId),
          }
        : d
    );
  };

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

  // Flattened to one row per material line — Alice works line by line, not
  // job by job, so the list reads like the schedule board's rows rather than
  // a stack of per-job cards.
  const allLines = matching.flatMap((h) =>
    linesFor(h).map((m) => ({
      ...m,
      jobId: h.jobId,
      project: h.project || h.client || "",
      fibreCement: h.fibreCement,
    }))
  );
  const isOutstandingLine = (m) => effectiveState(m) !== "completed";
  const counts = {
    outstanding: allLines.filter(isOutstandingLine).length,
    complete: allLines.filter((m) => !isOutstandingLine(m)).length,
  };
  const lines = allLines.filter((m) =>
    view === "outstanding" ? isOutstandingLine(m) : !isOutstandingLine(m)
  );
  // A job usually has several lines; the delete belongs against the first of
  // them rather than repeated on every row.
  const firstLineOfJob = new Map();
  for (const m of lines) {
    if (!firstLineOfJob.has(m.jobId)) firstLineOfJob.set(m.jobId, m.id);
  }

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
  // Dense, line-by-line rows — same feel as the schedule board rather than a
  // stack of per-job cards.
  const th = {
    fontWeight: 600,
    fontSize: 11,
    textAlign: "left",
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
    color: BRAND.sub,
  };
  const td = {
    padding: "5px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    fontSize: 12,
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
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
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
              {lines.length} {lines.length === 1 ? "line" : "lines"} · tick each line as it lands
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

        <Tabs current="materials" counts={{ materials: counts.outstanding }} />

        <div style={{ display: "flex", gap: 18, marginBottom: 16, borderBottom: `1px solid ${BRAND.line}` }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                border: "none",
                borderBottom: `2px solid ${view === v.key ? BRAND.sub : "transparent"}`,
                background: "none",
                color: view === v.key ? BRAND.ink : "#9c988f",
                fontWeight: view === v.key ? 600 : 400,
                fontSize: 12,
                padding: "0 0 7px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "inherit",
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

        {!loading && lines.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "outstanding"
                ? "Everything's in."
                : "Nothing fully in yet."}
          </p>
        )}

        {lines.length > 0 && (
          <div
            style={{
              overflowX: "auto",
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
            }}
          >
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={th}>Job</th>
                  <th style={th} />
                  <th style={th}>Project</th>
                  <th style={th}>Size</th>
                  <th style={{ ...th, textAlign: "right" }}>Qty</th>
                  <th style={th}>Material</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Expected</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((m) => {
                  const busy = pending[`${m.jobId}:${m.id}`];
                  const state = effectiveState(m);
                  const done = state === "completed";
                  return (
                    <tr key={`${m.jobId}:${m.id}`}>
                      <td style={td}>
                        {/* Only on lines that are done, and only once per job:
                            this removes the whole job, not the line. */}
                        {done && firstLineOfJob.get(m.jobId) === m.id && (
                          <button
                            onClick={() => deleteJob({ jobId: m.jobId, project: m.project })}
                            title={
                              `Delete job ${m.jobId} and everything on it — all its ` +
                              `material lines, and the job itself from the schedule ` +
                              `board, invoicing and the client link. Not just this row.`
                            }
                            style={deleteLinkStyle}
                          >
                            Delete job
                          </button>
                        )}
                      </td>
                      <td style={td}>
                        <a
                          href={`${HANDOVER_APP}/${encodeURIComponent(m.jobId)}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                        >
                          {m.jobId}
                        </a>
                        {m.fibreCement && (
                          <span style={{ marginLeft: 5, fontSize: 10, color: BRAND.sub, border: `1px solid ${BRAND.line}`, borderRadius: 4, padding: "0 4px" }}>
                            FC
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>{m.project || "—"}</td>
                      <td style={td}>{size(m)}</td>
                      <td style={{ ...td, textAlign: "right" }}>{m.quantity || "—"}</td>
                      <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>{m.name || "—"}</td>
                      <td style={{ ...td, color: BRAND.sub }}>{m.fromStock ? "Stock" : m.supplier || "—"}</td>
                      <td style={td}>
                        <input
                          type="date"
                          value={m.expectedDate || ""}
                          onChange={(e) => setLine(m.jobId, m.id, { expectedDate: e.target.value })}
                          title={
                            m.fromStock
                              ? "Optional — set or update this even for stock, if there's any uncertainty on timing"
                              : undefined
                          }
                          style={{
                            border: `1px solid ${BRAND.line}`,
                            borderRadius: 6,
                            padding: "2px 6px",
                            fontSize: 12,
                            fontFamily: "inherit",
                          }}
                        />
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {m.fromStock ? (
                          done ? (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <span
                                style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}
                                title={m.completedBy ? `Stock confirmed by ${m.completedBy}` : "Stock confirmed"}
                              >
                                ✓ In stock
                              </span>
                              <button
                                onClick={() => setLine(m.jobId, m.id, { state: "to_order" })}
                                disabled={busy}
                                style={{
                                  ...btn,
                                  background: BRAND.red,
                                  borderColor: BRAND.red,
                                  color: "#fff",
                                  opacity: busy ? 0.6 : 1,
                                }}
                              >
                                Undo
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setLine(m.jobId, m.id, { state: "completed" })}
                              disabled={busy}
                              style={{
                                ...btn,
                                background: BRAND.green,
                                borderColor: BRAND.green,
                                color: "#fff",
                                opacity: busy ? 0.6 : 1,
                              }}
                            >
                              Confirm stock
                            </button>
                          )
                        ) : (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            {state === "to_order" && (
                              <button
                                onClick={() => setLine(m.jobId, m.id, { state: "ordered" })}
                                disabled={busy}
                                style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                              >
                                Ordered
                              </button>
                            )}
                            {state === "ordered" && (
                              <>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "completed" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.green,
                                    borderColor: BRAND.green,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                >
                                  Delivered
                                </button>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "to_order" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.red,
                                    borderColor: BRAND.red,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                  title="Back to to-order"
                                >
                                  Undo
                                </button>
                              </>
                            )}
                            {done && (
                              <>
                                <span
                                  style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}
                                  title={m.completedBy ? `Delivered — confirmed by ${m.completedBy}` : "Delivered"}
                                >
                                  ✓ Delivered
                                </span>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "ordered" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.red,
                                    borderColor: BRAND.red,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                >
                                  Undo
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
