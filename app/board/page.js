"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import {
  PROCESS_COLUMNS,
  CELL_COLOURS,
  NEXT_STATE,
  cellState,
  leadFor,
  computedLead,
  leadShade,
} from "../../lib/board.js";

/**
 * The schedule board — Production Schedule 2026 Current.xlsx as a live table.
 *
 * A job appears here the moment Mitch hands it over, with the job number,
 * project, product and material already filled in and the process cells shaded
 * for the route he assigned. Duncan sets the dates and clicks cells as work
 * moves; nothing is typed twice.
 *
 * Materials is the exception: it mirrors Alice's ordering, amber once ordered
 * and green once it's arrived, so it isn't clickable here.
 *
 * This runs alongside Jordan's spreadsheet for now. The feed's main table still
 * reads the Excel, so nothing downstream changes until you decide to switch.
 */

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

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

export default function BoardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  // FC runs as a separate schedule, the way the spreadsheet keeps it in its
  // own block. Same columns, different list.
  const [stream, setStream] = useState("standard");
  const [user, setUser] = useState(null);
  // Edits applied locally the moment they're made, so typing doesn't wait on a
  // round trip. Replaced by the stored schedule once the write comes back.
  const [edits, setEdits] = useState({});

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

  const rows = useMemo(() => {
    const all = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])];
    const merged = all.map((h) => ({
      ...h,
      schedule: { ...(h.schedule || {}), ...(edits[h.jobId] || {}) },
    }));
    const inStream = merged.filter((h) =>
      stream === "fc" ? h.fibreCement : !h.fibreCement
    );
    const q = query.trim().toLowerCase();
    const matching = q
      ? inStream.filter((h) =>
          [h.jobId, h.project, h.client, h.product].join(" ").toLowerCase().includes(q)
        )
      : inStream;
    // Soonest out first, like the spreadsheet. Jobs with no date yet collect at
    // the bottom — they can't be ordered against dated work, and they're the
    // ones the count at the top of the page is pointing at.
    return matching.sort((a, b) => {
      const x = a.schedule?.committedDate || "";
      const y = b.schedule?.committedDate || "";
      if (!x && !y) return a.jobId.localeCompare(b.jobId);
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y);
    });
  }, [data, edits, query, stream]);

  const undated = rows.filter((r) => !r.schedule?.committedDate).length;
  const allRows = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])];
  const streamCounts = {
    standard: allRows.filter((h) => !h.fibreCement).length,
    fc: allRows.filter((h) => h.fibreCement).length,
  };

  const save = useCallback(
    async (jobId, patch) => {
      // Checked before the optimistic update, not after: showing a cell as
      // changed and then refusing to save it is worse than not moving at all.
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in to edit the schedule — changes are recorded against your name.");
        return;
      }
      setEdits((e) => ({ ...e, [jobId]: { ...(e[jobId] || {}), ...patch } }));
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/schedule-edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, patch, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Update failed");
      } catch (e) {
        setActionError(`Couldn't save ${jobId}. ${String(e.message || e)}`);
      }
    },
    []
  );

  const cycleCell = (row, column) => {
    const state = cellState(row, column);
    if (state === "none" || column.toLowerCase() === "materials") return;
    const next = NEXT_STATE[state] || "todo";
    save(row.jobId, {
      processState: { ...(row.schedule?.processState || {}), [column]: next },
    });
  };

  const th = {
    fontWeight: 600,
    fontSize: 11,
    textAlign: "left",
    padding: "6px 6px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
    verticalAlign: "bottom",
  };
  const td = {
    padding: "3px 6px",
    borderBottom: `1px solid ${BRAND.line}`,
    fontSize: 12,
    whiteSpace: "nowrap",
  };
  const input = {
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 12,
    fontFamily: "inherit",
    background: BRAND.card,
  };

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Schedule board
          </h1>
          <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
            {rows.length} handed-over {rows.length === 1 ? "job" : "jobs"}
            {undated > 0 && `, ${undated} still without a date`} · soonest out
            first
          </p>
        </div>
        <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
          <SignIn user={user} brand={BRAND} />
          <button
            onClick={load}
            style={{ ...input, padding: "6px 12px", fontSize: 13, cursor: "pointer" }}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <Tabs
        current="board"
        counts={{ materials: rows.filter((r) => r.materialOrder?.state !== "arrived").length }}
      />

      {actionError && (
        <div
          style={{
            background: "#fdf4e6",
            border: "1px solid #a86b12",
            color: "#a86b12",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {actionError}
        </div>
      )}
      {error && (
        <div
          style={{
            background: "#fbeceb",
            border: `1px solid ${BRAND.red}`,
            color: BRAND.red,
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          Couldn&apos;t load handovers. {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { key: "standard", label: "Standard production" },
          { key: "fc", label: "Fibre cement" },
        ].map((s2) => (
          <button
            key={s2.key}
            onClick={() => setStream(s2.key)}
            style={{
              ...input,
              padding: "5px 12px",
              fontSize: 13,
              cursor: "pointer",
              background: stream === s2.key ? BRAND.ink : BRAND.card,
              color: stream === s2.key ? "#fff" : BRAND.sub,
            }}
          >
            {s2.label} ({streamCounts[s2.key]})
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by job, project or product"
          style={{ ...input, flex: 1, maxWidth: 360, padding: "7px 10px", fontSize: 13 }}
        />
        <Legend />
      </div>

      {!loading && rows.length === 0 && (
        <p style={{ fontSize: 13, color: BRAND.sub }}>
          Nothing handed over yet. Jobs appear here the moment Mitch sends one to
          production.
        </p>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto", background: BRAND.card, border: `1px solid ${BRAND.line}`, borderRadius: 10 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 1500 }}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>Project</th>
                <th style={{ ...th, textAlign: "center" }}>Lumin</th>
                <th style={{ ...th, textAlign: "center" }}>Box</th>
                <th style={th}>Product</th>
                <th style={th}>Approval</th>
                <th style={th}>Committed</th>
                <th style={th}>Actual</th>
                <th style={{ ...th, textAlign: "center" }}>Lead (wks)</th>
                <th style={th}>Material due</th>
                {PROCESS_COLUMNS.map((c) => (
                  <th
                    key={c}
                    style={{
                      ...th,
                      textAlign: "center",
                      writingMode: "vertical-rl",
                      transform: "rotate(180deg)",
                      height: 90,
                      padding: "6px 2px",
                    }}
                  >
                    {c}
                  </th>
                ))}
                <th style={th}>Priority</th>
                <th style={th}>Comment</th>
                <th style={th}>Material</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const s = row.schedule || {};
                const lead = leadFor(s);
                const auto = computedLead(s.approvalDate, s.committedDate);
                return (
                  <tr key={row.jobId}>
                    <td style={td}>
                      <a
                        href={`${HANDOVER_APP}/${encodeURIComponent(row.jobId)}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                      >
                        {row.jobId}
                      </a>
                    </td>
                    <td style={td}>{row.project || row.client || "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(s.lumin)}
                        onChange={(e) => save(row.jobId, { lumin: e.target.checked })}
                      />
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(s.box)}
                        onChange={(e) => save(row.jobId, { box: e.target.checked })}
                      />
                    </td>
                    <td style={td}>{row.product || "—"}</td>
                    {["approvalDate", "committedDate", "actualDate"].map((field) => (
                      <td style={td} key={field}>
                        <input
                          type="date"
                          value={s[field] || ""}
                          onChange={(e) => save(row.jobId, { [field]: e.target.value })}
                          style={{ ...input, width: 130 }}
                        />
                      </td>
                    ))}
                    <td style={{ ...td, textAlign: "center", background: leadShade(lead) }}>
                      <input
                        value={lead ?? ""}
                        placeholder={auto == null ? "—" : String(auto)}
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          save(row.jobId, {
                            leadWeeks: v === "" ? null : Number(v) || 0,
                          });
                        }}
                        style={{ ...input, width: 52, textAlign: "center", background: "transparent" }}
                        title={
                          auto != null && lead !== auto
                            ? `Overridden — the dates give ${auto}`
                            : "Calculated from approval to committed; type to override"
                        }
                      />
                    </td>
                    <td style={{ ...td, color: BRAND.sub }}>
                      {row.materialAvailableDate || (
                        <span title="Every material is in">—</span>
                      )}
                    </td>
                    {PROCESS_COLUMNS.map((c) => {
                      const state = cellState(row, c);
                      const isMaterials = c.toLowerCase() === "materials";
                      return (
                        <td
                          key={c}
                          onClick={() => cycleCell(row, c)}
                          title={
                            isMaterials
                              ? `Materials — ${CELL_COLOURS[state].label} (set by Alice)`
                              : state === "none"
                                ? "Not part of this job"
                                : `${c} — ${CELL_COLOURS[state].label}. Click to advance.`
                          }
                          style={{
                            ...td,
                            padding: 0,
                            width: 26,
                            minWidth: 26,
                            background: CELL_COLOURS[state].bg,
                            cursor:
                              state === "none" || isMaterials ? "default" : "pointer",
                            borderRight: `1px solid ${BRAND.line}`,
                          }}
                        />
                      );
                    })}
                    <td style={td}>
                      <input
                        value={s.priority || ""}
                        onChange={(e) => save(row.jobId, { priority: e.target.value })}
                        style={{ ...input, width: 70 }}
                      />
                    </td>
                    <td style={td}>
                      <input
                        value={s.comment || ""}
                        onChange={(e) => save(row.jobId, { comment: e.target.value })}
                        placeholder="—"
                        style={{ ...input, width: 160 }}
                      />
                    </td>
                    <td style={{ ...td, whiteSpace: "normal", minWidth: 260, color: BRAND.sub }}>
                      {materialSummary(row)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function materialSummary(row) {
  const lines = (row.materials || []).filter((m) => m.name || m.quantity);
  if (lines.length === 0) return "—";
  return lines
    .map((m) => {
      const label = [m.quantity, m.name].filter(Boolean).join(" — ");
      if (m.state === "completed") return `${label} ✓${m.fromStock ? " stock" : ""}`;
      if (m.fromStock) return `${label} (stock — to confirm)`;
      if (m.state === "ordered") return `${label} (ordered${m.expectedDate ? ` ${m.expectedDate}` : ""})`;
      return `${label} (to order)`;
    })
    .join(" · ");
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#6b6862", flexWrap: "wrap" }}>
      {["todo", "doing", "done"].map((k) => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: CELL_COLOURS[k].bg,
              border: "1px solid #e5e1d8",
              display: "inline-block",
            }}
          />
          {CELL_COLOURS[k].label}
        </span>
      ))}
    </div>
  );
}
