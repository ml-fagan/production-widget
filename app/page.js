"use client";

import { useEffect, useState, useCallback } from "react";

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  blue: "#004CFB",
  amber: "#a86b12",
  red: "#a3312c",
};

// Auto-refresh cadence while the window is open (ms). 15 min.
const REFRESH_MS = 15 * 60 * 1000;

function leadColor(l) {
  if (l == null) return BRAND.sub;
  if (l >= 6) return BRAND.red;
  if (l >= 4.5) return BRAND.amber;
  return BRAND.green;
}

function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s + "T00:00:00");
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short" });
}

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Page() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState("dispatch");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load schedule");
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
    // Refresh when the window regains focus (e.g. opened each morning).
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const jobs = data?.jobs ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Remaining this week: today 00:00 through Sunday 23:59 of the current week.
  const dow = today.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const daysUntilSunday = (7 - dow) % 7; // Sun->0, Mon->6, Sat->1
  const weekEnd = new Date(today);
  weekEnd.setDate(today.getDate() + daysUntilSunday);

  const dueWeek = jobs.filter((j) => {
    if (!j.dispatch) return false;
    const d = new Date(j.dispatch + "T00:00:00");
    return d >= today && d <= weekEnd;
  }).length;
  const overdue = jobs.filter((j) => j.overdue).length;

  // Overdue = a job we're not delivering as promised. Either:
  //  (a) it has slipped — the effective dispatch date is later than the
  //      committed/promised date, or
  //  (b) its promised (committed) date is already in the past.
  const behindPromise = jobs.filter((j) => {
    if (!j.committed) return false;
    const committedD = new Date(j.committed + "T00:00:00");
    const slipped =
      j.dispatch && new Date(j.dispatch + "T00:00:00") > committedD;
    const promisePast = committedD < today;
    return slipped || promisePast;
  }).length;

  let list = jobs.filter(
    (j) =>
      j.crm.toLowerCase().includes(query.toLowerCase()) ||
      j.project.toLowerCase().includes(query.toLowerCase())
  );
  if (sortMode === "dispatch") {
    list = [...list].sort((a, b) => {
      if (!a.dispatch) return 1;
      if (!b.dispatch) return -1;
      return new Date(a.dispatch) - new Date(b.dispatch);
    });
  } else {
    list = [...list].sort((a, b) => (b.lead || 0) - (a.lead || 0));
  }

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
            <img
              src="/decor-logo-white.png"
              alt="Decor Systems"
              style={{
                height: 34,
                width: "auto",
                display: "block",
                marginBottom: 12,
                // Logo asset is white; this page's background is always pale, so render it black.
                filter: "brightness(0)",
              }}
            />
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Production Schedule
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Decor Systems factory · live from SharePoint
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
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

        {error && (
          <div
            style={{
              background: "#fbeceb",
              border: `1px solid ${BRAND.red}`,
              color: BRAND.red,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn't load the schedule. {error}
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Stat label="Active jobs" value={jobs.length} />
          <Stat label="Avg lead time" value={data?.avgLead ?? "—"} suffix=" wks" />
          <Stat label="Remaining this week" value={dueWeek} />
          <Stat label="Overdue" value={behindPromise} tone={behindPromise ? BRAND.red : BRAND.ink} />
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by CRM or project"
            style={{
              flex: 1,
              border: `1px solid ${BRAND.line}`,
              background: BRAND.card,
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              color: BRAND.ink,
              outline: "none",
            }}
          />
          <button
            onClick={() => setSortMode(sortMode === "dispatch" ? "lead" : "dispatch")}
            style={{
              border: `1px solid ${BRAND.line}`,
              background: BRAND.card,
              color: BRAND.ink,
              borderRadius: 8,
              padding: "9px 14px",
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "inherit",
              whiteSpace: "nowrap",
            }}
          >
            Sort: {sortMode === "dispatch" ? "Dispatch" : "Lead time"}
          </button>
        </div>

        <div
          style={{
            border: `1px solid ${BRAND.line}`,
            borderRadius: 12,
            overflow: "hidden",
            background: BRAND.card,
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: BRAND.bg, textAlign: "left" }}>
                <Th w={90}>CRM</Th>
                <Th>Project</Th>
                <Th w={76}>Promised</Th>
                <Th w={76}>Dispatch</Th>
                <Th w={28}></Th>
                <Th w={54} right>
                  Lead
                </Th>
                <Th w={104}>Link</Th>
              </tr>
            </thead>
            <tbody>
              {list.map((j, i) => (
                <tr key={j.crm + j.project} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                  <td
                    style={{
                      padding: "10px 14px",
                      fontFamily: "'SF Mono', ui-monospace, monospace",
                      fontSize: 13,
                      color: BRAND.sub,
                    }}
                  >
                    {j.crm}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {j.project}
                    {j.overdue && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: BRAND.red,
                          border: `1px solid ${BRAND.red}`,
                          borderRadius: 4,
                          padding: "1px 6px",
                        }}
                      >
                        overdue
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px", color: BRAND.sub }}>
                    {fmtDate(j.committed)}
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      color: j.committed && j.actual && j.committed !== j.actual ? BRAND.red : BRAND.sub,
                      fontWeight: j.committed && j.actual && j.committed !== j.actual ? 500 : 400,
                    }}
                  >
                    {fmtDate(j.dispatch)}
                  </td>
                  <td style={{ padding: "10px 6px", textAlign: "center" }}>
                    <AsanaFlag check={j.asanaCheck} />
                  </td>
                  <td
                    style={{
                      padding: "10px 14px",
                      textAlign: "right",
                      color: leadColor(j.lead),
                      fontWeight: 500,
                    }}
                  >
                    {j.lead != null ? j.lead : "—"}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <CopyLink link={j.clientLink} />
                  </td>
                </tr>
              ))}
              {list.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: "24px 14px", textAlign: "center", color: BRAND.sub }}>
                    No jobs match that filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 11, color: BRAND.sub, marginTop: 14, textAlign: "center" }}>
          Lead time colour: green under 4.5 wks · amber 4.5–6 · red 6+.
          {data?.fileModified ? ` Source file modified ${fmtDate(data.fileModified.slice(0, 10))}.` : ""}
        </p>

        <div
          style={{
            marginTop: 28,
            paddingTop: 16,
            borderTop: `1px solid ${BRAND.line}`,
            textAlign: "center",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.12em",
            color: BRAND.blue,
          }}
        >
          BY LYPHEX
        </div>
      </div>
    </main>
  );
}

// Cross-check against the "3. Production" Asana board: red "!" when the
// dispatch date doesn't line up with Asana's Due date (or the job couldn't be
// matched/verified there); green tick when it's confirmed aligned.
function AsanaFlag({ check }) {
  if (!check) return null;
  const warn = check.status === "warn";
  let title = "";
  if (check.reason === "match") title = `Matches Asana — ${check.taskName} (due ${fmtDate(check.asanaDue)})`;
  else if (check.reason === "date_mismatch")
    title = `Dispatch date doesn't match Asana — ${check.taskName}: due ${fmtDate(check.asanaDue)}`;
  else if (check.reason === "no_match") title = "No matching Asana task found for this CRM/handover";
  else if (check.reason === "ambiguous")
    title = `Multiple Asana tasks match this CRM/handover — can't verify:\n${check.candidates
      .map((c) => `${c.name} (due ${fmtDate(c.due)})`)
      .join("\n")}`;
  else if (check.reason === "asana_unavailable") title = `Asana check unavailable: ${check.error || "unknown error"}`;

  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        borderRadius: 4,
        background: warn ? BRAND.red : "transparent",
        color: warn ? "#ffffff" : BRAND.green,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {warn ? "!" : "✓"}
    </span>
  );
}

function Stat({ label, value, suffix = "", tone }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e5e1d8", borderRadius: 10, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, color: "#6b6862", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color: tone || "#1c1b19" }}>
        {value}
        {suffix && <span style={{ fontSize: 13, color: "#6b6862", fontWeight: 400 }}>{suffix}</span>}
      </div>
    </div>
  );
}

function CopyLink({ link }) {
  const [copied, setCopied] = useState(false);
  if (!link) return <span style={{ color: "#c9c5bc", fontSize: 12 }}>—</span>;
  const view = () => {
    window.open(link, "_blank", "noopener,noreferrer");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy this client link:", link);
    }
  };
  const btnStyle = {
    border: "1px solid #e5e1d8",
    background: "#ffffff",
    color: "#004CFB",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <button onClick={view} title={link} style={btnStyle}>
        View
      </button>
      <button
        onClick={copy}
        title={link}
        style={{
          ...btnStyle,
          background: copied ? "#e2efda" : "#ffffff",
          color: copied ? "#3B6D11" : "#004CFB",
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Th({ children, w, right }) {
  return (
    <th
      style={{
        padding: "10px 14px",
        fontWeight: 500,
        color: "#6b6862",
        fontSize: 13,
        width: w,
        textAlign: right ? "right" : "left",
      }}
    >
      {children}
    </th>
  );
}
