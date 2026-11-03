"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import { PAGE_WIDTH, HEADER_HEIGHT, HEADER_GAP } from "../../lib/layout.js";
import { baseCrm } from "../../lib/crmUtils.js";
import { refreshLoop } from "../../lib/refresh.js";
import {
  leadSamples,
  promisedDelivery,
  lastApprovalDate,
  missesRequirement,
  describeLead,
} from "../../lib/leadTime.js";

// Projects — one board per project manager.
//
// Everything else in this app is the factory's view of a job: what to buy,
// what to make, when it ships. This is the client's view of the same job, and
// the two ask different questions. The factory wants to know what is on the
// saw this morning. A project manager wants to know which of their twenty
// clients has not signed yet, and which of the ones who have are going to be
// late.
//
// A row is a PROJECT, not a handover. 21516-1 and 21516-4 are parts of one job
// to everybody here and one job to the client too; the client signed once and
// gets one delivery. The parts are aggregated: the project is as far along as
// its least advanced part, and it is delivered when the last one goes.
//
// Who gets a board is decided by the access grant and nothing else — give
// somebody Projects and their board exists. Everybody with the area reads
// everybody's; a project is editable only by whoever owns it, and an unclaimed
// one is anybody's to take. That is the whole permission model, and it is
// deliberately about the project rather than about the tab: two project
// managers with identical access own different work.

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

// Same banding as the drafting register and the schedule board, so a colour
// means the same thing wherever somebody sees it.
const BAND = {
  overdue: { colour: BRAND.red, weight: 600 },
  soon: { colour: BRAND.amber, weight: 600 },
  fine: { colour: BRAND.sub, weight: 400 },
  none: { colour: "#b3afa6", weight: 400 },
};

const SOON_DAYS = 14;

const REFRESH_MS = 10 * 60 * 1000;

/** Where a project is, in the words a project manager would use. */
const STAGE_LABEL = {
  with_client: "With client",
  approved: "Approved",
  awaiting_schedule: "Awaiting scheduling",
  scheduled: "Scheduled",
  in_production: "In production",
  despatched: "Despatched",
  invoiced: "Invoiced",
  closed: "Closed",
};

// Least advanced first: a project is where its furthest-behind part is.
const STAGE_ORDER = [
  "with_client",
  "approved",
  "awaiting_schedule",
  "scheduled",
  "in_production",
  "despatched",
  "invoiced",
  "closed",
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/**
 * One project, from its parts and its plan.
 *
 * The approval can come from three places and `approvalOf` on the shared board
 * module already ranks them; here it only matters that ANY part carries one,
 * because the approve route writes it to all of them and a part written
 * afterwards inherits it.
 */
function buildProject(crm, parts, plan, samples) {
  const live = parts.filter((p) => p.state !== "closed");
  const approval =
    parts.map((p) => p.approval).find((a) => a && a.date) ||
    (parts.map((p) => p.approvalDate).find(Boolean)
      ? { date: parts.map((p) => p.approvalDate).find(Boolean), by: "", at: null, source: "handover" }
      : null);

  let stage = approval ? "approved" : "with_client";
  if (parts.length) {
    const states = parts.map((p) => p.state || "awaiting_schedule");
    stage = STAGE_ORDER.find((s) => states.includes(s)) || states[0];
    // A part that exists but has no approval recorded is still with the
    // client as far as this board is concerned — the factory may be ahead of
    // the paperwork, and that is worth seeing rather than smoothing over.
    if (!approval && STAGE_ORDER.indexOf(stage) < STAGE_ORDER.indexOf("awaiting_schedule")) {
      stage = "with_client";
    }
  }

  // When the whole project is out: the last part to go.
  const dispatches = parts
    .map((p) => p.schedule?.actualDate || p.schedule?.committedDate || "")
    .filter(Boolean)
    .sort();
  const scheduled = dispatches.length ? dispatches[dispatches.length - 1] : "";

  /**
   * What we have told the client, or would tell them.
   *
   * Once Duncan has committed every part, his dates are the answer and the
   * forecast steps aside — the brief is explicit that the arithmetic runs from
   * his date outwards once it exists. Until then the promise is worked out
   * forward from the signature.
   */
  const everyPartCommitted =
    parts.length > 0 && parts.every((p) => p.schedule?.committedDate);
  const forecast = approval?.date ? promisedDelivery(approval.date, samples) : null;
  const promised = everyPartCommitted ? scheduled : forecast?.client || "";

  const deadline = !approval?.date && plan.neededOnSite
    ? lastApprovalDate(plan.neededOnSite, samples, { adjustDays: plan.approvalAdjustDays || 0 })
    : null;

  // The one comparison the needed-on-site date exists to make.
  const against =
    promised && plan.neededOnSite ? missesRequirement(promised, plan.neededOnSite) : null;

  let band = "none";
  let note = "";
  if (!approval?.date && deadline?.client) {
    const left = daysBetween(today(), deadline.client);
    band = left < 0 ? "overdue" : left <= SOON_DAYS ? "soon" : "fine";
    note =
      left < 0
        ? `Sign-off was due ${-left} ${-left === 1 ? "day" : "days"} ago`
        : `${left} ${left === 1 ? "day" : "days"} to sign off`;
  } else if (against) {
    band = against.late ? "overdue" : against.days > -SOON_DAYS ? "soon" : "fine";
    note = against.late
      ? `${against.days} ${against.days === 1 ? "day" : "days"} late for site`
      : `${-against.days} ${-against.days === 1 ? "day" : "days"} spare`;
  } else if (!plan.neededOnSite) {
    note = "No site date set";
  }

  return {
    crm,
    client: parts.find((p) => p.client)?.client || "",
    project: parts.find((p) => p.project)?.project || "",
    parts: parts.map((p) => p.jobId).sort(),
    liveParts: live.length,
    stage,
    approval,
    scheduled,
    promised,
    forecast,
    deadline,
    plan,
    band,
    note,
    sortKey: `${band === "overdue" ? 0 : band === "soon" ? 1 : 2}${
      deadline?.client || promised || "9999-99-99"
    }`,
  };
}

export default function ProjectsPage() {
  const [handovers, setHandovers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [managers, setManagers] = useState([]);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState("");
  const [who, setWho] = useState(null);
  const [filter, setFilter] = useState("");
  const caps = useCapabilities(user);

  const me = String(user?.email || "").trim().toLowerCase();
  // Holding the area at edit is what makes somebody a project manager. The
  // server decides per project; this only decides what the screen offers.
  const isManager = managers.some((m) => m.email === me && m.level === "edit");
  const canManageAny = Boolean(caps.manage);

  useEffect(() => {
    if (!firebaseConfigured()) return undefined;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, pRes] = await Promise.all([
        fetch("/api/handovers", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
      ]);
      const hJson = await hRes.json();
      const pJson = await pRes.json();
      if (!hJson.ok) throw new Error(hJson.error || "Could not load the jobs");
      if (!pJson.ok) throw new Error(pJson.error || "Could not load the plans");
      // The route hands back Duncan's two queues rather than one list — jobs
      // waiting for a date, and jobs that have one. This board wants both: a
      // project is a project before anybody schedules it.
      setHandovers([...(hJson.awaiting || []), ...(hJson.scheduled || [])]);
      setPlans(pJson.plans || []);
      setManagers(pJson.managers || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Braces matter: an arrow that returns load() hands React a Promise, and
  // React calls whatever an effect returns as the cleanup function.
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => refreshLoop(load, REFRESH_MS), [load]);

  // Your own board, once we know who you are and which boards exist.
  useEffect(() => {
    if (who !== null || !me || !managers.length) return;
    setWho(managers.some((m) => m.email === me) ? me : "all");
  }, [me, managers, who]);

  const samples = useMemo(() => leadSamples(handovers), [handovers]);

  const projects = useMemo(() => {
    const planFor = new Map(plans.map((p) => [p.crm, p]));
    const byProject = new Map();
    for (const h of handovers) {
      const base = baseCrm(h.jobId);
      if (!byProject.has(base)) byProject.set(base, []);
      byProject.get(base).push(h);
    }
    // A project somebody has planned but nobody has written a handover for
    // yet. It is the whole reason the plan is its own record, so it had
    // better appear.
    for (const crm of planFor.keys()) if (!byProject.has(crm)) byProject.set(crm, []);

    const blank = { neededOnSite: "", approvalAdjustDays: 0, projectManager: "" };
    return [...byProject.entries()]
      .map(([crm, parts]) => buildProject(crm, parts, planFor.get(crm) || blank, samples))
      .filter((p) => p.stage !== "closed")
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [handovers, plans, samples]);

  const countFor = useCallback(
    (email) =>
      projects.filter((p) =>
        email === "all" ? true : email === "" ? !p.plan.projectManager : p.plan.projectManager === email
      ).length,
    [projects]
  );

  const shown = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return projects
      .filter((p) =>
        who === "all" || who === null
          ? true
          : who === ""
            ? !p.plan.projectManager
            : p.plan.projectManager === who
      )
      .filter((p) =>
        !term ? true : `${p.crm} ${p.client} ${p.project}`.toLowerCase().includes(term)
      );
  }, [projects, who, filter]);

  const save = useCallback(
    async (crm, patch) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first.");
        return;
      }
      setSaving(crm);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crm, ...patch, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Save failed");
        setPlans((prev) => {
          const rest = prev.filter((p) => p.crm !== crm);
          return [...rest, json.plan];
        });
      } catch (e) {
        setActionError(String(e.message || e));
      } finally {
        setSaving("");
      }
    },
    []
  );

  const approve = useCallback(
    async (crm, date) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first.");
        return;
      }
      setSaving(crm);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/projects/approve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ crm, date, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Could not record it");
        await load();
      } catch (e) {
        setActionError(String(e.message || e));
      } finally {
        setSaving("");
      }
    },
    [load]
  );

  const atRisk = projects.filter((p) => p.band === "overdue").length;
  const leadNow = describeLead(
    samples.length ? { ...promisedDelivery(today(), samples) } : null
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

  const th = {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 500,
    color: BRAND.sub,
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };
  const td = {
    fontSize: 13,
    padding: "8px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    verticalAlign: "top",
  };
  const input = {
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 12,
    fontFamily: "inherit",
    background: BRAND.card,
    color: BRAND.ink,
  };

  return (
    <main
      style={{
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        background: BRAND.bg,
        minHeight: "100vh",
        padding: "28px 24px 60px",
        color: BRAND.ink,
      }}
    >
      <div style={{ maxWidth: PAGE_WIDTH, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: HEADER_GAP,
            minHeight: HEADER_HEIGHT,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Projects
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {projects.length} live ·{" "}
              <span style={{ color: atRisk ? BRAND.red : BRAND.sub, fontWeight: atRisk ? 600 : 400 }}>
                {atRisk} needing attention
              </span>{" "}
              · running at {leadNow}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs tabs={caps.tabs} current="projects" />

        {/* One pill per project manager. The count is their live projects, so
            somebody can see at a glance who is carrying what. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "16px 0 12px" }}>
          {[
            { email: "all", name: "Everyone" },
            ...managers,
            { email: "", name: "Unassigned" },
          ].map((m) => {
            const active = who === m.email;
            const n = countFor(m.email);
            if (m.email === "" && n === 0) return null;
            // Not just `m.email === me`: signed out, `me` is empty and so is
            // the Unassigned pill's email, which had it reading "(you)".
            const isMine = Boolean(me) && m.email === me;
            return (
              <button
                key={m.email || "unassigned"}
                onClick={() => setWho(m.email)}
                style={{
                  ...btn,
                  background: active ? BRAND.ink : BRAND.card,
                  color: active ? "#fff" : BRAND.ink,
                  fontWeight: isMine ? 600 : 400,
                }}
                title={isMine ? "Your board" : m.email || "Nobody has taken these"}
              >
                {m.name}
                {isMine ? " (you)" : ""}
                <span style={{ marginLeft: 6, opacity: 0.7 }}>{n}</span>
              </button>
            );
          })}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by job, client or project"
          style={{ ...input, width: "100%", padding: "9px 12px", fontSize: 13, marginBottom: 14 }}
        />

        {actionError && (
          <div
            style={{
              background: "#fdf4e6",
              border: `1px solid ${BRAND.amber}`,
              color: BRAND.amber,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 14,
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
              marginBottom: 14,
            }}
          >
            {error}
          </div>
        )}

        {!managers.length && !loading && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            Nobody has been given the Projects area yet, so there are no boards. An admin grants
            it on the Access tab — give somebody Edit and their board appears here.
          </p>
        )}

        <div style={{ background: BRAND.card, border: `1px solid ${BRAND.line}`, borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Job</th>
                <th style={th}>Client / project</th>
                <th style={th}>Stage</th>
                <th style={th}>Approved</th>
                <th style={th}>Needed on site</th>
                <th style={th}>± days</th>
                <th style={th}>Sign off by</th>
                <th style={th}>Promised</th>
                <th style={th}>Where it stands</th>
                <th style={th}>Owner</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const owned = !p.plan.projectManager || p.plan.projectManager === me;
                const editable = (isManager && owned) || canManageAny;
                const busy = saving === p.crm;
                const band = BAND[p.band];
                return (
                  <tr key={p.crm} style={{ opacity: busy ? 0.5 : 1 }}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {p.crm}
                      {p.parts.length > 1 && (
                        <div style={{ fontSize: 11, color: BRAND.sub, fontWeight: 400 }}>
                          {p.parts.length} parts
                        </div>
                      )}
                    </td>
                    <td style={{ ...td, maxWidth: 260 }}>
                      {p.client || "—"}
                      {p.project && (
                        <div style={{ fontSize: 11, color: BRAND.sub }}>{p.project}</div>
                      )}
                    </td>
                    <td style={{ ...td, color: BRAND.sub }}>{STAGE_LABEL[p.stage] || p.stage}</td>
                    <td style={td}>
                      {p.approval?.date ? (
                        <>
                          {fmtDay(p.approval.date)}
                          <div style={{ fontSize: 11, color: BRAND.sub }}>
                            {p.approval.source === "pm"
                              ? p.approval.by || "recorded"
                              : "typed on the handover"}
                          </div>
                        </>
                      ) : editable ? (
                        <input
                          type="date"
                          max={today()}
                          style={input}
                          title="The day the client signed"
                          onChange={(e) => e.target.value && approve(p.crm, e.target.value)}
                        />
                      ) : (
                        <span style={{ color: BAND.none.colour }}>not yet</span>
                      )}
                    </td>
                    <td style={td}>
                      {editable ? (
                        <input
                          type="date"
                          value={p.plan.neededOnSite || ""}
                          style={input}
                          onChange={(e) => save(p.crm, { neededOnSite: e.target.value })}
                        />
                      ) : (
                        fmtDay(p.plan.neededOnSite)
                      )}
                    </td>
                    <td style={td}>
                      {editable ? (
                        <input
                          type="number"
                          value={p.plan.approvalAdjustDays || 0}
                          style={{ ...input, width: 58 }}
                          title="Shift this client's sign-off deadline. Positive gives them longer."
                          onChange={(e) =>
                            save(p.crm, { approvalAdjustDays: Number(e.target.value) || 0 })
                          }
                        />
                      ) : (
                        p.plan.approvalAdjustDays || 0
                      )}
                    </td>
                    <td style={{ ...td, color: band.colour, fontWeight: band.weight }}>
                      {p.approval?.date ? "—" : fmtDay(p.deadline?.client)}
                    </td>
                    <td style={td}>
                      {fmtDay(p.promised)}
                      {p.promised && !p.scheduled && (
                        <div style={{ fontSize: 11, color: BRAND.sub }}>forecast</div>
                      )}
                    </td>
                    <td style={{ ...td, color: band.colour, fontWeight: band.weight }}>
                      {p.note || "—"}
                    </td>
                    <td style={td}>
                      {editable ? (
                        <select
                          value={p.plan.projectManager || ""}
                          style={input}
                          onChange={(e) => save(p.crm, { projectManager: e.target.value })}
                        >
                          <option value="">Unassigned</option>
                          {managers
                            .filter((m) => m.level === "edit")
                            .map((m) => (
                              <option key={m.email} value={m.email}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span style={{ color: BRAND.sub }}>
                          {managers.find((m) => m.email === p.plan.projectManager)?.name ||
                            p.plan.projectManager ||
                            "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && !loading && (
                <tr>
                  <td colSpan={10} style={{ ...td, color: BRAND.sub, textAlign: "center", padding: 24 }}>
                    Nothing on this board.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 14, maxWidth: 820 }}>
          Sign-off dates and promised dates carry a week for getting a signed job onto the floor,
          and come off the median lead of the jobs already scheduled around that date — so they
          move as the book fills. Once every part of a job has a committed date, Duncan&apos;s
          dates are shown instead of the forecast.
        </p>
      </div>
      {!user && firebaseConfigured() && <div />}
    </main>
  );
}
