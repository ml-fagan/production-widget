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

  const isOutstanding = (h) => {
    const lines = linesFor(h);
    if (lines.length === 0) return true;
    return lines.some((m) => effectiveState(m) !== "completed");
  };
  const counts = {
    outstanding: matching.filter(isOutstanding).length,
    complete: matching.filter((h) => !isOutstanding(h)).length,
  };
  const jobs = matching.filter((h) =>
    view === "outstanding" ? isOutstanding(h) : !isOutstanding(h)
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
              {jobs.length} {jobs.length === 1 ? "job" : "jobs"} · tick each line
              as it lands
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

        <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
          {[
            { key: "orders", label: "Orders" },
            { key: "tracking", label: "Material tracking" },
          ].map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              style={{
                ...btn,
                padding: "5px 12px",
                background: mode === m.key ? BRAND.blue : BRAND.card,
                color: mode === m.key ? "#fff" : BRAND.sub,
                borderColor: mode === m.key ? BRAND.blue : BRAND.line,
                fontSize: 13,
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "orders" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
            {VIEWS.map((v) => (
              <button
                key={v.key}
                onClick={() => setView(v.key)}
                style={{
                  ...btn,
                  padding: "5px 12px",
                  background: view === v.key ? BRAND.ink : BRAND.card,
                  color: view === v.key ? "#fff" : BRAND.sub,
                  fontSize: 13,
                }}
              >
                {v.label} ({counts[v.key]})
              </button>
            ))}
          </div>
        )}

        {mode === "tracking" && (
          <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { key: "project", label: "By project" },
              { key: "material", label: "By material" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTrackBy(t.key)}
                style={{
                  ...btn,
                  padding: "5px 12px",
                  background: trackBy === t.key ? BRAND.ink : BRAND.card,
                  color: trackBy === t.key ? "#fff" : BRAND.sub,
                  fontSize: 13,
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

        {mode === "orders" && !loading && jobs.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "outstanding"
                ? "Everything's in."
                : "Nothing fully in yet."}
          </p>
        )}

        {mode === "orders" && (
        <div style={{ display: "grid", gap: 12 }}>
          {jobs.map((h) => {
            const lines = linesFor(h);
            const outstanding = lines.filter(
              (m) => effectiveState(m) !== "completed"
            ).length;
            return (
              <section
                key={h.jobId}
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.line}`,
                  borderLeft: `3px solid ${outstanding === 0 ? BRAND.green : BRAND.amber}`,
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
                  {h.fibreCement && (
                    <span style={{ fontSize: 11, color: BRAND.sub, border: `1px solid ${BRAND.line}`, borderRadius: 4, padding: "1px 6px" }}>
                      FC
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: BRAND.sub, marginLeft: "auto" }}>
                    {outstanding === 0
                      ? "all in"
                      : `${outstanding} of ${lines.length} outstanding`}
                  </span>
                </div>

                {lines.length ? (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: BRAND.sub }}>
                        <th style={{ fontWeight: 500, padding: "2px 0" }}>Size</th>
                        <th style={{ fontWeight: 500, width: 70 }}>Qty</th>
                        <th style={{ fontWeight: 500 }}>Product</th>
                        <th style={{ fontWeight: 500, width: 130 }}>Supplier</th>
                        <th style={{ fontWeight: 500, width: 140 }}>Expected</th>
                        <th style={{ fontWeight: 500, width: 150 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((m) => {
                        const busy = pending[`${h.jobId}:${m.id}`];
                        const state = effectiveState(m);
                        const done = state === "completed";
                        return (
                          <tr key={m.id} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                            <td style={{ padding: "6px 0" }}>{size(m)}</td>
                            <td>{m.quantity || "—"}</td>
                            <td>{m.name || "—"}</td>
                            <td style={{ color: BRAND.sub }}>
                              {m.fromStock ? "Stock" : m.supplier || "—"}
                            </td>
                            <td>
                              {m.fromStock ? (
                                <span style={{ color: BRAND.sub }}>—</span>
                              ) : (
                                <input
                                  type="date"
                                  value={m.expectedDate || ""}
                                  onChange={(e) =>
                                    setLine(h.jobId, m.id, { expectedDate: e.target.value })
                                  }
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
                            <td style={{ textAlign: "right" }}>
                              {m.fromStock ? (
                                done ? (
                                  <button
                                    onClick={() => setLine(h.jobId, m.id, { state: "to_order" })}
                                    disabled={busy}
                                    style={{ ...btn, color: BRAND.green }}
                                    title={
                                      m.completedBy
                                        ? `Stock confirmed by ${m.completedBy}`
                                        : "Stock confirmed"
                                    }
                                  >
                                    ✓ In stock
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => setLine(h.jobId, m.id, { state: "completed" })}
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
                                      onClick={() => setLine(h.jobId, m.id, { state: "ordered" })}
                                      disabled={busy}
                                      style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                                    >
                                      Ordered
                                    </button>
                                  )}
                                  {state === "ordered" && (
                                    <>
                                      <button
                                        onClick={() => setLine(h.jobId, m.id, { state: "completed" })}
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
                                        onClick={() => setLine(h.jobId, m.id, { state: "to_order" })}
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
                                      onClick={() => setLine(h.jobId, m.id, { state: "ordered" })}
                                      disabled={busy}
                                      style={{ ...btn, color: BRAND.green }}
                                      title={
                                        m.completedBy
                                          ? `Completed by ${m.completedBy}`
                                          : "Completed"
                                      }
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
                ) : (
                  <p style={{ fontSize: 13, color: BRAND.sub, margin: 0 }}>
                    No materials listed on this handover yet.
                  </p>
                )}
              </section>
            );
          })}
        </div>
        )}

        {mode === "tracking" && (
          <MaterialTracking jobs={matching} trackBy={trackBy} />
        )}
      </div>
    </main>
  );
}


// Where each material actually is, read straight off Duncan's schedule board
// rather than anyone asking around the factory.
function MaterialTracking({ jobs, trackBy }) {
  if (jobs.length === 0) {
    return <p style={{ fontSize: 13, color: BRAND.sub }}>Nothing handed over yet.</p>;
  }

  if (trackBy === "project") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {jobs.map((h) => (
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
          </section>
        ))}
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
