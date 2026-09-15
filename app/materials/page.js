"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

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
//
// The handover app works the state out the same way and sends it down, so this
// only stands in for a row that predates the field.
function effectiveState(m) {
  return m.state || "to_order";
}

/**
 * How many a quantity means. "2 Rolls", "37 + 3 Spare" — every number counts,
 * matching the rule the handover app uses, so 200 of 300 means the same thing
 * on both screens.
 */
function countOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const found = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  return found ? found.reduce((sum, n) => sum + Number(n), 0) : 0;
}

/** "200 of 300 in · 100 to come", for a line that arrived in more than one drop. */
function receivedLabel(m) {
  const had = countOf(m.receivedQty);
  const want = countOf(m.quantity);
  if (!had) return "";
  return want > had ? `${had} of ${want} in · ${want - had} to come` : `${had} in`;
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
  // Whether this person may change anything here, as opposed to read it.
  const caps = useCapabilities(user);
  const canEdit = caps.materials;
  // What's been typed into a Received box but not saved yet, keyed by line.
  // The box was uncontrolled before, which meant a re-render could quietly
  // put the old number back under her cursor.
  const [received, setReceived] = useState({});
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
    if (!canEdit) {
      setActionError("This board is Alice's — you can see it, but not change it.");
      return;
    }
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
  }, [canEdit]);

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
  // Part received is still outstanding: some of it is on a truck somewhere.
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

        <Tabs
          tabs={caps.tabs}
          current="materials"
          counts={{
            materials: counts.outstanding,
            // Shown on every strip so finished-but-unbilled work reaches
            // Veronica wherever she is, rather than only once she looks.
            invoicing: all.filter((h) => h.state === "despatched").length,
          }}
        />

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
                      <td style={{ ...td, textAlign: "right", whiteSpace: "normal" }}>
                        {m.quantity || "—"}
                        {/* The short version of a part delivery, where the eye
                            lands rather than out in the status column. */}
                        {receivedLabel(m) && !done && (
                          <div style={{ fontSize: 11, color: BRAND.amber }}>
                            {receivedLabel(m)}
                          </div>
                        )}
                      </td>
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
                            {(state === "ordered" || state === "part_received") && (
                              <>
                                {/* What's landed so far. A big order rarely
                                    arrives at once, and a line that can only be
                                    ordered or delivered can't say 200 of 300 —
                                    which is the thing Duncan needs to know. */}
                                {(() => {
                                  const key = `${m.jobId}:${m.id}`;
                                  const stored = String(m.receivedQty ?? "");
                                  const draft = received[key] ?? stored;
                                  const changed = draft.trim() !== stored.trim();
                                  const save = () => {
                                    if (!changed) return;
                                    setLine(m.jobId, m.id, { receivedQty: draft.trim() });
                                    // Dropped so the box falls back to what
                                    // came back from the server, rather than
                                    // showing a draft that may not have saved.
                                    setReceived((r) => {
                                      const next = { ...r };
                                      delete next[key];
                                      return next;
                                    });
                                  };
                                  return (
                                    <span
                                      style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
                                    >
                                      <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        value={draft}
                                        onChange={(e) =>
                                          setReceived((r) => ({ ...r, [key]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") save();
                                          if (e.key === "Escape") {
                                            setReceived((r) => {
                                              const next = { ...r };
                                              delete next[key];
                                              return next;
                                            });
                                          }
                                        }}
                                        onBlur={save}
                                        disabled={busy}
                                        title="How many have landed. Set the Expected date to when the rest is due."
                                        aria-label={`Received of ${m.quantity}`}
                                        style={{
                                          width: 54,
                                          border: `1px solid ${changed ? BRAND.amber : BRAND.line}`,
                                          borderRadius: 6,
                                          padding: "2px 6px",
                                          fontSize: 12,
                                          fontFamily: "inherit",
                                        }}
                                      />
                                      <span style={{ fontSize: 11, color: BRAND.sub }}>
                                        of {m.quantity || "—"}
                                      </span>
                                      {/* An explicit way to commit it. Relying
                                          on the blur alone meant typing a
                                          number and navigating away lost it,
                                          with nothing on screen to say so. */}
                                      {changed && (
                                        <button
                                          onClick={save}
                                          disabled={busy}
                                          style={{
                                            ...btn,
                                            background: BRAND.amber,
                                            borderColor: BRAND.amber,
                                            color: "#fff",
                                            opacity: busy ? 0.6 : 1,
                                          }}
                                        >
                                          Save
                                        </button>
                                      )}
                                    </span>
                                  );
                                })()}
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
                                  title="All in — closes the line whatever the count says"
                                >
                                  All in
                                </button>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "to_order", receivedQty: "" })}
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
