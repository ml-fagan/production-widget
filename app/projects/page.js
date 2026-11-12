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
import { leadSamples, promisedDelivery, describeLead } from "../../lib/leadTime.js";
import { criticalPath } from "../../lib/criticalPath.js";
import { siteDateOf } from "../../lib/board.js";
// Brisbane's today, not UTC's. See the note in criticalPath.
import { today } from "../../lib/drafting.js";

// Projects — one board per project manager, and every project's critical path
// on it.
//
// Everything else in this app is the factory's view of a job: what to buy,
// what to make, when it ships. This is the client's view of the same job, and
// the two ask different questions. The factory wants to know what is on the
// saw this morning. A project manager wants to know which of their twenty
// clients has not signed yet, and which of the ones who have are going to be
// late.
//
// A card is a PROJECT, not a handover. 21516-1 and 21516-4 are one job to the
// client, who signed once and takes one delivery, so the parts are
// aggregated: the chain is as far along as its furthest-behind part.
//
// Cards rather than a table, and all of them on the one page rather than one
// job at a time. A critical path is a shape — five things in order, and where
// this job has stopped — and a row of columns cannot show a shape. The point
// of the board is reading twelve of them in one pass and seeing which two
// have stalled, which means twelve chains on one screen, not a list you click
// into twelve times.
//
// Who gets a board is decided by the access grant and nothing else. Everybody
// with the area reads everybody's; a project is editable only by whoever owns
// it, and an unclaimed one is anybody's to take.

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
  overdue: { colour: BRAND.red, bg: "#fbeceb" },
  soon: { colour: BRAND.amber, bg: "#fdf4e6" },
  fine: { colour: BRAND.sub, bg: "#f3f1ea" },
};

const STEP = {
  done: { fill: BRAND.green, ring: BRAND.green, label: BRAND.ink },
  current: { fill: BRAND.blue, ring: BRAND.blue, label: BRAND.ink },
  overdue: { fill: BRAND.red, ring: BRAND.red, label: BRAND.red },
  upcoming: { fill: "#ffffff", ring: "#d3d1c7", label: "#9a968e" },
  // Not "not yet" — "we cannot say". A dashed ring rather than a solid one,
  // so a step nobody records reads differently from one still to come.
  unknown: { fill: "#ffffff", ring: "#d3d1c7", label: "#b3afa6", dashed: true },
};

const REFRESH_MS = 10 * 60 * 1000;

function fmtDay(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

export default function ProjectsPage() {
  const [handovers, setHandovers] = useState([]);
  const [drafting, setDrafting] = useState([]);
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
  const isManager = managers.some((m) => m.email === me && m.level === "edit");
  const canManageAny = Boolean(caps.manage);

  useEffect(() => {
    if (!firebaseConfigured()) return undefined;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, pRes, dRes] = await Promise.all([
        fetch("/api/handovers", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" }),
        // The drawing sets, for the first link in the chain. Best-effort: the
        // register is Asana's and a job with no task is a job with no issue
        // date, not a broken board.
        fetch("/api/drafting", { cache: "no-store" }).catch(() => null),
      ]);
      const hJson = await hRes.json();
      const pJson = await pRes.json();
      if (!hJson.ok) throw new Error(hJson.error || "Could not load the jobs");
      if (!pJson.ok) throw new Error(pJson.error || "Could not load the plans");
      // The route hands back Duncan's two queues rather than one list — jobs
      // waiting for a date, and jobs that have one. A project is a project
      // before anybody schedules it, so this board wants both.
      setHandovers([...(hJson.awaiting || []), ...(hJson.scheduled || [])]);
      setPlans(pJson.plans || []);
      setManagers(pJson.managers || []);
      if (dRes) {
        const dJson = await dRes.json().catch(() => null);
        if (dJson?.ok) setDrafting(dJson.rows || []);
      }
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
    // yet. It is the whole reason the plan is its own record.
    for (const crm of planFor.keys()) if (!byProject.has(crm)) byProject.set(crm, []);

    // Drawing sets only. The register carries Veronica's overdue accounts in
    // the same list — 81 of its 114 rows — and an unpaid invoice is not a
    // drawing issue, so counting one as the first link in this chain would
    // date the drawings from a conversation about money.
    const draftingFor = new Map();
    for (const row of drafting) {
      if (row.kind === "accounts") continue;
      const base = baseCrm(row.crm || "");
      if (!base) continue;
      if (!draftingFor.has(base)) draftingFor.set(base, []);
      draftingFor.get(base).push(row);
    }

    const blank = { neededOnSite: "", approvalAdjustDays: 0, projectManager: "" };
    const todayISO = today();

    return [...byProject.entries()]
      .map(([crm, parts]) => {
        const plan = planFor.get(crm) || blank;
        const path = criticalPath({
          parts,
          draftingRows: draftingFor.get(crm) || [],
          /**
           * The project's own date, or the earliest its sections carry.
           *
           * Derived here rather than inside criticalPath, because that file
           * is one of a matched pair with decorhandover's and the two have to
           * go on agreeing about what a date means. What changes is the date
           * handed to it — and both boards hand it the same one, so a job
           * dated only by its sections cannot read "no site date" on one
           * board and "overdue" on the other.
           */
          plan: { ...plan, neededOnSite: siteDateOf(plan) },
          samples,
          todayISO,
        });
        return {
          crm,
          parts,
          plan,
          path,
          client: parts.find((p) => p.client)?.client || "",
          project: parts.find((p) => p.project)?.project || "",
          partIds: parts.map((p) => p.jobId).sort(),
          sortKey: `${path.band === "overdue" ? 0 : path.band === "soon" ? 1 : 2}${
            path.deadline?.client || path.promised || "9999-99-99"
          }`,
        };
      })
      .filter((p) => !p.parts.length || !p.parts.every((h) => h.state === "closed"))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [handovers, drafting, plans, samples]);

  const countFor = useCallback(
    (email) =>
      projects.filter((p) =>
        email === "all"
          ? true
          : email === ""
            ? !p.plan.projectManager
            : p.plan.projectManager === email
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

  const save = useCallback(async (crm, patch) => {
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
      setPlans((prev) => [...prev.filter((p) => p.crm !== crm), json.plan]);
    } catch (e) {
      setActionError(String(e.message || e));
    } finally {
      setSaving("");
    }
  }, []);

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

  const atRisk = projects.filter((p) => p.path.band === "overdue").length;
  const leadNow = samples.length
    ? describeLead(promisedDelivery(today(), samples))
    : "no scheduled work to read a lead time from yet";

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

        {/* One pill per project manager, with their live count, so somebody
            can see at a glance who is carrying what. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "16px 0 12px" }}>
          {[{ email: "all", name: "Everyone" }, ...managers, { email: "", name: "Unassigned" }].map(
            (m) => {
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
            }
          )}
        </div>

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by job, client or project"
          style={{ ...input, width: "100%", padding: "9px 12px", fontSize: 13, marginBottom: 14 }}
        />

        {actionError && <Banner colour={BRAND.amber} bg="#fdf4e6" text={actionError} />}
        {error && <Banner colour={BRAND.red} bg="#fbeceb" text={error} />}

        {!managers.length && !loading && (
          <p style={{ fontSize: 13, color: BRAND.sub, maxWidth: 820 }}>
            Nobody has been given the Projects area yet, so there are no boards. An admin grants it
            on the Access tab — give somebody Edit and their board appears here.
          </p>
        )}

        <div style={{ display: "grid", gap: 12 }}>
          {shown.map((p) => (
            <ProjectCard
              key={p.crm}
              p={p}
              me={me}
              managers={managers}
              editable={(isManager && (!p.plan.projectManager || p.plan.projectManager === me)) || canManageAny}
              busy={saving === p.crm}
              onSave={save}
              onApprove={approve}
              input={input}
            />
          ))}
          {!shown.length && !loading && (
            <p style={{ fontSize: 13, color: BRAND.sub, textAlign: "center", padding: 24 }}>
              Nothing on this board.
            </p>
          )}
        </div>

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18, maxWidth: 900, lineHeight: 1.6 }}>
          The chain is read from the records each step already keeps: the drafting register, the
          approval somebody recorded, Alice&apos;s board, the schedule board. Nothing on it is
          typed twice. Sign-off and delivery dates both carry a week for getting a signed job onto
          the floor, and come off the median lead of the jobs already scheduled around that date,
          so they move as the book fills. Once every part of a job has a committed date,
          Duncan&apos;s dates are shown instead of the forecast.
        </p>
      </div>
    </main>
  );
}

function Banner({ colour, bg, text }) {
  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${colour}`,
        color: colour,
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        marginBottom: 14,
      }}
    >
      {text}
    </div>
  );
}

function ProjectCard({ p, me, managers, editable, busy, onSave, onApprove, input }) {
  const { path } = p;
  const band = BAND[path.band] || BAND.fine;
  const owner =
    managers.find((m) => m.email === p.plan.projectManager)?.name || p.plan.projectManager || "";

  return (
    <section
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.line}`,
        borderLeft: `3px solid ${path.band === "overdue" ? BRAND.red : path.band === "soon" ? BRAND.amber : BRAND.line}`,
        borderRadius: 10,
        padding: "14px 18px 16px",
        opacity: busy ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{p.crm}</span>
            <span style={{ fontSize: 14 }}>{p.client || "—"}</span>
            {p.partIds.length > 1 && (
              <span style={{ fontSize: 11, color: BRAND.sub }} title={p.partIds.join(", ")}>
                {p.partIds.length} parts
              </span>
            )}
            {!p.parts.length && (
              <span style={{ fontSize: 11, color: BRAND.amber }}>no handover yet</span>
            )}
          </div>
          {p.project && (
            <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 2 }}>{p.project}</div>
          )}
        </div>

        {/* The project manager's own fields. Everything else on the card is
            read from somebody else's record. */}
        <div style={{ display: "flex", gap: 14, alignItems: "flex-end", flexWrap: "wrap" }}>
          <Field label="Needed on site">
            {editable ? (
              <input
                type="date"
                value={p.plan.neededOnSite || ""}
                style={input}
                onChange={(e) => onSave(p.crm, { neededOnSite: e.target.value })}
              />
            ) : (
              <span style={{ fontSize: 12 }}>{fmtDay(p.plan.neededOnSite) || "—"}</span>
            )}
            {/* Blank here but dated section by section on the project sheet.
                Said out loud, or the box looks like missing information while
                the chain beside it is running to a date. */}
            {!p.plan.neededOnSite && siteDateOf(p.plan) && (
              <div style={{ fontSize: 10.5, color: BRAND.sub, marginTop: 2 }}>
                sections: {fmtDay(siteDateOf(p.plan))}
              </div>
            )}
          </Field>
          <Field label="± days">
            {editable ? (
              <input
                type="number"
                value={p.plan.approvalAdjustDays || 0}
                style={{ ...input, width: 56 }}
                title="Shift this client's sign-off deadline. Positive gives them longer."
                onChange={(e) => onSave(p.crm, { approvalAdjustDays: Number(e.target.value) || 0 })}
              />
            ) : (
              <span style={{ fontSize: 12 }}>{p.plan.approvalAdjustDays || 0}</span>
            )}
          </Field>
          <Field label="Owner">
            {editable ? (
              <select
                value={p.plan.projectManager || ""}
                style={input}
                onChange={(e) => onSave(p.crm, { projectManager: e.target.value })}
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
              <span style={{ fontSize: 12 }}>{owner || "—"}</span>
            )}
          </Field>
        </div>
      </div>

      <Chain steps={path.steps} />

      <div
        style={{
          background: band.bg,
          border: `1px solid ${band.colour}33`,
          borderRadius: 8,
          padding: "8px 12px",
          marginTop: 14,
          fontSize: 12.5,
          color: band.colour === BRAND.sub ? BRAND.ink : band.colour,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>{path.headline}</span>
        {!path.approvalDate && editable && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: BRAND.ink }}>
            <span style={{ fontSize: 11, color: BRAND.sub }}>Client signed</span>
            <input
              type="date"
              max={today()}
              style={input}
              title="The day the client signed. Everything after it is worked out from this date."
              onChange={(e) => e.target.value && onApprove(p.crm, e.target.value)}
            />
          </label>
        )}
      </div>
    </section>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: BRAND.sub, marginBottom: 3, letterSpacing: "0.02em" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * The five milestones as a chain.
 *
 * The line between two circles is green only where the step BEFORE it is
 * done, so the colour runs out exactly where the job has got to — which is
 * the one thing somebody scanning twelve of these is looking for.
 */
function Chain({ steps }) {
  return (
    <div style={{ display: "flex", marginTop: 14 }}>
      {steps.map((s, i) => {
        const look = STEP[s.state] || STEP.upcoming;
        const prevDone = i > 0 && steps[i - 1].state === "done";
        return (
          <div
            key={s.key}
            style={{ flex: 1, position: "relative", textAlign: "center", minWidth: 0 }}
          >
            {i > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: 11,
                  right: "50%",
                  width: "100%",
                  height: 2,
                  background: prevDone ? BRAND.green : BRAND.line,
                }}
              />
            )}
            <div
              style={{
                position: "relative",
                width: 24,
                height: 24,
                margin: "0 auto",
                borderRadius: "50%",
                background: look.fill,
                border: `2px ${look.dashed ? "dashed" : "solid"} ${look.ring}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1,
              }}
              title={s.note || s.label}
            >
              {s.state === "done" ? (
                <Check />
              ) : s.state === "overdue" ? (
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>!</span>
              ) : s.state === "current" ? (
                <span
                  style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff" }}
                />
              ) : null}
            </div>
            <div
              style={{
                fontSize: 11.5,
                marginTop: 6,
                color: look.label,
                fontWeight: s.state === "current" || s.state === "overdue" ? 600 : 400,
                padding: "0 4px",
              }}
            >
              {s.label}
            </div>
            <div style={{ fontSize: 11, color: BRAND.sub, marginTop: 1 }}>
              {fmtDay(s.date) || (s.state === "done" ? "done" : "—")}
            </div>
            {s.note && (
              <div style={{ fontSize: 10.5, color: "#9a968e", marginTop: 1 }}>{s.note}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Check() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#fff"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
