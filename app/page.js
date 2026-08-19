"use client";

import { useEffect, useState, useCallback } from "react";
import { baseCrm, crmLooksValid } from "../lib/crmUtils.js";
import Tabs from "./Tabs.js";
import { leadFor } from "../lib/board.js";

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

// Pending generated links, remembered per-browser only (personal convenience
// for whoever drafts these — not shared across staff/devices).
const PENDING_LINKS_KEY = "decor-pending-client-links";

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
  const [genCrm, setGenCrm] = useState("");
  const [genName, setGenName] = useState("");
  const [genResult, setGenResult] = useState(null); // { link } | null
  const [genError, setGenError] = useState(null);
  const [genLoading, setGenLoading] = useState(false);
  const [pendingLinks, setPendingLinks] = useState([]);
  const [pendingLoaded, setPendingLoaded] = useState(false);
  const [awaiting, setAwaiting] = useState([]);
  const [unordered, setUnordered] = useState([]);
  const [handovers, setHandovers] = useState([]);

  // Load once on mount (localStorage isn't available during SSR).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PENDING_LINKS_KEY) || "[]");
      if (Array.isArray(saved)) setPendingLinks(saved);
    } catch {
      // Corrupt/blocked storage — just start empty.
    }
    setPendingLoaded(true);
  }, []);

  // Save on every change, but not before the initial load above has run
  // (otherwise this would overwrite saved data with the empty initial state).
  useEffect(() => {
    if (!pendingLoaded) return;
    try {
      localStorage.setItem(PENDING_LINKS_KEY, JSON.stringify(pendingLinks));
    } catch {
      // Storage full/blocked — pending list just won't persist this time.
    }
  }, [pendingLinks, pendingLoaded]);

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

  // Logged handovers waiting for a date. Loaded separately from the schedule so
  // the feed still works exactly as before if the handover app is unreachable.
  const loadHandovers = useCallback(async () => {
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setHandovers([...(json.awaiting || []), ...(json.scheduled || [])]);
      setAwaiting(json.awaiting || []);
      setUnordered(
        [...(json.awaiting || []), ...(json.scheduled || [])].filter(
          (h) => (h.materialOrder?.state || "not_ordered") === "not_ordered"
        )
      );
    } catch {
      setHandovers([]);
      setAwaiting([]);
      setUnordered([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadHandovers();
    const id = setInterval(() => {
      load();
      loadHandovers();
    }, REFRESH_MS);
    // Refresh when the window regains focus (e.g. opened each morning).
    const onFocus = () => {
      load();
      loadHandovers();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadHandovers]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sheetJobs = data?.jobs ?? [];

  // Jobs Duncan has dated on the schedule board but which haven't reached
  // Jordan's spreadsheet yet. Shown here so a scheduled job is visible to the
  // company without being typed twice.
  //
  // The spreadsheet still wins where both have the same CRM: it remains the
  // source of truth, and this page shouldn't start disagreeing with it. As the
  // board takes over, the sheet simply supplies fewer and fewer rows.
  const sheetCrms = new Set(sheetJobs.map((j) => String(j.crm).trim().toLowerCase()));
  const boardJobs = handovers
    .filter((h) => h.schedule?.committedDate)
    .filter((h) => !sheetCrms.has(String(h.jobId).trim().toLowerCase()))
    .map((h) => {
      const committed = h.schedule.committedDate || null;
      const actual = h.schedule.actualDate || null;
      const dispatch = actual || committed;
      return {
        crm: h.jobId,
        project: h.project || h.client || "",
        committed,
        actual,
        dispatch,
        lead: leadFor(h.schedule),
        priority: h.schedule.priority || "",
        fc: false,
        // Same rule the spreadsheet parser uses: past its date with nothing
        // recorded as finished.
        overdue: Boolean(
          committed && !actual && new Date(committed + "T00:00:00") < today
        ),
        fromBoard: true,
        clientLink: null,
        asanaCheck: null,
      };
    });

  const jobs = [...sheetJobs, ...boardJobs];

  // Checked against the schedule already loaded above — no extra fetch.
  const knownBaseCrms = new Set(jobs.map((j) => baseCrm(j.crm)));
  const genNotScheduled = genResult != null && !knownBaseCrms.has(baseCrm(genResult.crm));
  const genFormatInvalid = genCrm.trim().length > 0 && !crmLooksValid(genCrm);

  const generateLink = useCallback(async () => {
    const crm = genCrm.trim();
    if (!crm) return;
    setGenLoading(true);
    setGenError(null);
    setGenResult(null);
    try {
      const res = await fetch(`/api/genlink?crm=${encodeURIComponent(crm)}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't generate a link.");
      const name = genName.trim();
      // Placeholder name travels in the link itself (no server storage) — the
      // client-tracker shows it as "coming soon" until the CRM hits the real
      // schedule, at which point it always uses the real name instead.
      const link = name ? `${json.link}?name=${encodeURIComponent(name)}` : json.link;
      setGenResult({ link, crm });
      setPendingLinks((prev) => [
        { crm, name, link, createdAt: Date.now() },
        ...prev.filter((p) => baseCrm(p.crm) !== baseCrm(crm)),
      ]);
    } catch (e) {
      setGenError(String(e.message || e));
    } finally {
      setGenLoading(false);
    }
  }, [genCrm, genName]);

  const removePendingLink = useCallback((crm) => {
    setPendingLinks((prev) => prev.filter((p) => p.crm !== crm));
  }, []);

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

        <Tabs
          current="schedule"
          counts={{ board: awaiting.length, materials: unordered.length }}
        />
        <HandoverNote awaiting={awaiting} unordered={unordered} />

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
                    {j.fromBoard && (
                      <span
                        title="Dated on the schedule board — not in the spreadsheet yet"
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: BRAND.green,
                          border: `1px solid ${BRAND.green}`,
                          borderRadius: 4,
                          padding: "1px 6px",
                        }}
                      >
                        board
                      </span>
                    )}
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
            marginTop: 20,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 12,
            background: BRAND.card,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Generate client link</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={genCrm}
              onChange={(e) => {
                setGenCrm(e.target.value);
                setGenResult(null);
                setGenError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !genFormatInvalid) generateLink();
              }}
              placeholder="CRM number, e.g. 21811 or 21811-1"
              style={{
                flex: 1,
                border: `1px solid ${BRAND.line}`,
                background: BRAND.bg,
                borderRadius: 8,
                padding: "9px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                color: BRAND.ink,
                outline: "none",
              }}
            />
            <button
              onClick={generateLink}
              disabled={!genCrm.trim() || genFormatInvalid || genLoading}
              style={{
                border: `1px solid ${BRAND.line}`,
                background: BRAND.card,
                color: BRAND.ink,
                borderRadius: 8,
                padding: "9px 16px",
                fontSize: 13,
                cursor: !genCrm.trim() || genFormatInvalid || genLoading ? "default" : "pointer",
                opacity: !genCrm.trim() || genFormatInvalid || genLoading ? 0.6 : 1,
                fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              {genLoading ? "Generating…" : "Generate"}
            </button>
          </div>

          <input
            value={genName}
            onChange={(e) => setGenName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !genFormatInvalid) generateLink();
            }}
            placeholder="Project name (optional — shown as a placeholder until it's in the schedule)"
            style={{
              width: "100%",
              boxSizing: "border-box",
              marginTop: 8,
              border: `1px solid ${BRAND.line}`,
              background: BRAND.bg,
              borderRadius: 8,
              padding: "9px 12px",
              fontSize: 13,
              fontFamily: "inherit",
              color: BRAND.ink,
              outline: "none",
            }}
          />

          {genFormatInvalid && !genError && (
            <div style={{ marginTop: 10, fontSize: 12, color: BRAND.sub }}>
              Doesn't look like a CRM number yet — e.g. 21811 or 21811-1.
            </div>
          )}

          {genError && (
            <div style={{ marginTop: 10, fontSize: 13, color: BRAND.red }}>{genError}</div>
          )}

          {genResult && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span
                  style={{
                    fontSize: 13,
                    color: BRAND.sub,
                    fontFamily: "'SF Mono', ui-monospace, monospace",
                    wordBreak: "break-all",
                  }}
                >
                  {genResult.link}
                </span>
                <CopyLink link={genResult.link} />
              </div>
              {genNotScheduled && (
                <div style={{ marginTop: 8, fontSize: 12, color: BRAND.sub }}>
                  This CRM isn't in the current schedule yet — the link is still valid and will
                  start working as soon as the job appears.
                </div>
              )}
            </div>
          )}

          {pendingLinks.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 14, borderTop: `1px solid ${BRAND.line}` }}>
              <div style={{ fontSize: 12, color: BRAND.sub, marginBottom: 8 }}>
                Pending links (saved in this browser only)
              </div>
              {pendingLinks.map((p) => {
                const scheduled = knownBaseCrms.has(baseCrm(p.crm));
                return (
                  <div
                    key={p.crm}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                      padding: "8px 0",
                      borderTop: `1px solid ${BRAND.line}`,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontSize: 13 }}>{p.name || p.crm}</div>
                      <div style={{ fontSize: 11, color: BRAND.sub }}>
                        {p.crm}
                        {" · "}
                        <span style={{ color: scheduled ? BRAND.green : BRAND.amber }}>
                          {scheduled ? "Now in schedule" : "Not scheduled yet"}
                        </span>
                      </div>
                    </div>
                    <CopyLink link={p.link} />
                    <button
                      onClick={() => removePendingLink(p.crm)}
                      title="Remove from this list"
                      style={{
                        border: `1px solid ${BRAND.line}`,
                        background: BRAND.bg,
                        color: BRAND.sub,
                        borderRadius: 6,
                        padding: "4px 8px",
                        fontSize: 12,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

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
// One line above the schedule, not a section: the schedule is what the company
// reads this page for, and handover queues live on their own tabs.
function HandoverNote({ awaiting, unordered }) {
  if (!awaiting?.length && !unordered?.length) return null;

  return (
    <p
      style={{
        fontSize: 13,
        color: BRAND.sub,
        margin: "0 0 16px",
        display: "flex",
        gap: 14,
        flexWrap: "wrap",
      }}
    >
      {awaiting.length > 0 && (
        <span>
          <strong style={{ color: BRAND.ink }}>{awaiting.length}</strong>{" "}
          {awaiting.length === 1 ? "project" : "projects"} awaiting a date ·{" "}
          <a href="/board" style={{ color: BRAND.blue }}>
            view
          </a>
        </span>
      )}
      {unordered.length > 0 && (
        <span>
          <strong style={{ color: BRAND.ink }}>{unordered.length}</strong> material{" "}
          {unordered.length === 1 ? "order" : "orders"} not yet placed ·{" "}
          <a href="/materials" style={{ color: BRAND.blue }}>
            view
          </a>
        </span>
      )}
    </p>
  );
}

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
