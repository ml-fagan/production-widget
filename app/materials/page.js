"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { PROCESS_COLUMNS, CELL_COLOURS, cellState } from "../../lib/board.js";

// Material orders board.
//
// Alice works line by line, not job by job: one job can need three materials
// from three suppliers landing weeks apart. Each line moves to order → ordered
// → completed and carries the date she expects it, which is what Duncan
// schedules against. A job is only "in" when every line is.

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

// Where a job actually is on Duncan's board right now: whichever assigned
// process is under way, or else the furthest one finished, or else the
// first not yet started. Tells Alice where her material physically is
// without her having to go and ask.
function currentStage(handover) {
  const relevant = PROCESS_COLUMNS.filter((c) => cellState(handover, c) !== "none");
  if (relevant.length === 0) return null;
  const doing = relevant.find((c) => cellState(handover, c) === "doing");
  if (doing) return { stage: doing, state: "doing" };
  const done = relevant.filter((c) => cellState(handover, c) === "done");
  if (done.length === relevant.length) return { stage: "Packed", state: "done" };
  if (done.length) return { stage: done[done.length - 1], state: "done" };
  return { stage: relevant[0], state: "todo" };
}

function StageBadge({ handover }) {
  const stage = currentStage(handover);
  if (!stage) return <span style={{ color: "#6b6862", fontSize: 12 }}>—</span>;
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 4,
        background: stage.stage === "Packed" ? "#cfe3d4" : CELL_COLOURS[stage.state].bg,
        border: "1px solid #e5e1d8",
      }}
    >
      {stage.stage}
    </span>
  );
}

function materialSignature(m) {
  return [String(m.name || "").trim().toLowerCase(), m.length, m.width, m.thickness].join("|");
}

// Same materials, regrouped by what they are rather than which job they're
// for — so Alice can see every job waiting on "Blackbutt NTV" in one place.
function buildMaterialGroups(jobs) {
  const map = new Map();
  for (const h of jobs) {
    for (const m of h.materials || []) {
      const key = materialSignature(m);
      if (!map.has(key)) {
        map.set(key, { name: m.name, length: m.length, width: m.width, thickness: m.thickness, rows: [] });
      }
      map.get(key).rows.push({ ...m, jobId: h.jobId, project: h.project || h.client, handover: h });
    }
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

// Only "used" entries (negative) assigned to this exact job — a leftover
// logged *from* this job is the opposite direction, not "fetch this".
function stockForJob(stockEntries, jobId) {
  const used = stockEntries.filter((e) => e.jobId === jobId && Number(e.quantity) < 0);
  const map = new Map();
  for (const e of used) {
    const key = [e.name, e.length, e.width, e.thickness].join("|");
    const size = [e.length, e.width, e.thickness].filter(Boolean).join("×");
    const bucket = map.get(key) || { name: e.name, size, qty: 0 };
    bucket.qty += Math.abs(Number(e.quantity) || 0);
    map.set(key, bucket);
  }
  return [...map.values()];
}

export default function MaterialsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("outstanding");
  const [mode, setMode] = useState("orders"); // orders | tracking
  const [trackBy, setTrackBy] = useState("project"); // project | material
  const [user, setUser] = useState(null);
  const [pending, setPending] = useState({});
  // What the server stored, adopted after each write so what's on screen is
  // its answer rather than our guess.
  const [stored, setStored] = useState({});
  const [stockEntries, setStockEntries] = useState([]);

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

  // For Material tracking — stock assigned to a job shows there too, same as
  // on the Schedule board.
  const loadStock = useCallback(async () => {
    try {
      const res = await fetch("/api/material-stock", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setStockEntries(json.entries || []);
    } catch {
      // Tracking just shows order status/stage without a stock note.
    }
  }, []);

  useEffect(() => {
    load();
    loadStock();
    const id = setInterval(() => {
      load();
      loadStock();
    }, REFRESH_MS);
    const onFocus = () => {
      load();
      loadStock();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadStock]);

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
              Material orders/tracking
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {mode === "orders"
                ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} · tick each line as it lands`
                : `${matching.length} ${matching.length === 1 ? "job" : "jobs"}`}
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

        <div
          style={{
            display: "inline-flex",
            background: "#efece5",
            borderRadius: 10,
            padding: 3,
            marginBottom: 16,
          }}
        >
          {[
            { key: "orders", label: "Orders" },
            { key: "tracking", label: "Material tracking" },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                border: "none",
                background: mode === m.key ? "#fff" : "transparent",
                color: mode === m.key ? BRAND.ink : BRAND.sub,
                fontWeight: mode === m.key ? 600 : 500,
                fontSize: 14,
                padding: "8px 20px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: mode === m.key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "orders" && (
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
        )}

        {mode === "tracking" && (
          <div style={{ display: "flex", gap: 18, marginBottom: 16, borderBottom: `1px solid ${BRAND.line}` }}>
            {[
              { key: "project", label: "By project" },
              { key: "material", label: "By material" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTrackBy(t.key)}
                style={{
                  border: "none",
                  borderBottom: `2px solid ${trackBy === t.key ? BRAND.sub : "transparent"}`,
                  background: "none",
                  color: trackBy === t.key ? BRAND.ink : "#9c988f",
                  fontWeight: trackBy === t.key ? 600 : 400,
                  fontSize: 12,
                  padding: "0 0 7px",
                  marginBottom: -1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

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

        {mode === "orders" && !loading && lines.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "outstanding"
                ? "Everything's in."
                : "Nothing fully in yet."}
          </p>
        )}

        {mode === "orders" && lines.length > 0 && (
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
                  <th style={th}>Project</th>
                  <th style={th}>Size</th>
                  <th style={{ ...th, textAlign: "right" }}>Qty</th>
                  <th style={th}>Material</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>Expected</th>
                  <th style={th}></th>
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
                        {m.fromStock ? (
                          <span style={{ color: BRAND.sub }}>—</span>
                        ) : (
                          <input
                            type="date"
                            value={m.expectedDate || ""}
                            onChange={(e) => setLine(m.jobId, m.id, { expectedDate: e.target.value })}
                            style={{
                              border: `1px solid ${BRAND.line}`,
                              borderRadius: 6,
                              padding: "2px 6px",
                              fontSize: 12,
                              fontFamily: "inherit",
                            }}
                          />
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {m.fromStock ? (
                          done ? (
                            <button
                              onClick={() => setLine(m.jobId, m.id, { state: "to_order" })}
                              disabled={busy}
                              style={{ ...btn, color: BRAND.green }}
                              title={m.completedBy ? `Stock confirmed by ${m.completedBy}` : "Stock confirmed"}
                            >
                              ✓ In stock
                            </button>
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
                                  Complete
                                </button>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "to_order" })}
                                  disabled={busy}
                                  style={{ ...btn, color: BRAND.sub }}
                                  title="Back to to-order"
                                >
                                  Undo
                                </button>
                              </>
                            )}
                            {done && (
                              <button
                                onClick={() => setLine(m.jobId, m.id, { state: "ordered" })}
                                disabled={busy}
                                style={{ ...btn, color: BRAND.green }}
                                title={m.completedBy ? `Completed by ${m.completedBy}` : "Completed"}
                              >
                                ✓ In
                              </button>
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

        {mode === "tracking" && (
          <MaterialTracking jobs={matching} trackBy={trackBy} stockEntries={stockEntries} />
        )}
      </div>
    </main>
  );
}


// Where each material actually is, read straight off Duncan's schedule board
// rather than anyone asking around the factory.
function MaterialTracking({ jobs, trackBy, stockEntries }) {
  if (jobs.length === 0) {
    return <p style={{ fontSize: 13, color: BRAND.sub }}>Nothing handed over yet.</p>;
  }

  if (trackBy === "project") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {jobs.map((h) => {
          const fromStock = stockForJob(stockEntries, h.jobId);
          return (
          <section
            key={h.jobId}
            style={{
              background: "#fff",
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{h.jobId}</span>
              <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
              <span style={{ marginLeft: "auto" }}>
                <StageBadge handover={h} />
              </span>
            </div>
            {(h.materials || []).length === 0 ? (
              <p style={{ fontSize: 13, color: BRAND.sub, margin: 0 }}>No materials listed yet.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: BRAND.sub }}>
                    <th style={{ fontWeight: 500, padding: "2px 0" }}>Size</th>
                    <th style={{ fontWeight: 500, width: 70 }}>Qty</th>
                    <th style={{ fontWeight: 500 }}>Material</th>
                    <th style={{ fontWeight: 500, width: 110 }}>Order status</th>
                  </tr>
                </thead>
                <tbody>
                  {(h.materials || []).map((m) => (
                    <tr key={m.id} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                      <td style={{ padding: "6px 0" }}>{size(m)}</td>
                      <td>{m.quantity || "—"}</td>
                      <td>{m.name || "—"}</td>
                      <td style={{ color: BRAND.sub }}>{effectiveState(m).replace("_", " ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {fromStock.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: BRAND.red, fontWeight: 500 }}>
                {fromStock.map((s, i) => (
                  <div key={i}>
                    From stock: {s.qty} × {s.name}
                    {s.size ? ` (${s.size})` : ""}
                  </div>
                ))}
              </div>
            )}
          </section>
          );
        })}
      </div>
    );
  }

  // By material: the same lines, regrouped so every job needing "Blackbutt
  // NTV" (say) shows in one place regardless of which job it's for.
  const groups = buildMaterialGroups(jobs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {groups.map((g) => (
        <section
          key={materialSignature(g)}
          style={{
            background: "#fff",
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            {g.name || "—"}
            {g.length && g.width ? (
              <span style={{ fontWeight: 400, color: BRAND.sub, marginLeft: 8 }}>
                {g.length} × {g.width}
                {g.thickness ? ` × ${g.thickness}` : ""}
              </span>
            ) : null}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: BRAND.sub }}>
                <th style={{ fontWeight: 500, padding: "2px 0" }}>Job</th>
                <th style={{ fontWeight: 500 }}>Project</th>
                <th style={{ fontWeight: 500, width: 70 }}>Qty</th>
                <th style={{ fontWeight: 500, width: 110 }}>Order status</th>
                <th style={{ fontWeight: 500, width: 130 }}>Stage</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={`${r.jobId}:${r.id}`} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                  <td style={{ padding: "6px 0" }}>{r.jobId}</td>
                  <td>{r.project || "—"}</td>
                  <td>{r.quantity || "—"}</td>
                  <td style={{ color: BRAND.sub }}>{effectiveState(r).replace("_", " ")}</td>
                  <td>
                    <StageBadge handover={r.handover} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
