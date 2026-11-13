"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import { PAGE_WIDTH, HEADER_HEIGHT, HEADER_GAP } from "../../lib/layout.js";
import { refreshLoop } from "../../lib/refresh.js";
import { errorText } from "../../lib/routeError.js";

/**
 * Timeline — what happened to every project, and when.
 *
 * It replaces the projects board that used to sit on this tab. That board was
 * a tile per project with a chain of five circles on it, and the project
 * managers' real one lives in the handover app; what the factory actually
 * wanted from this end was never another board to work from. It was the
 * answer to one question, asked constantly and answered by opening four
 * screens: what happened to this job, and when.
 *
 * So this is a record rather than a board. Nothing on it can be changed,
 * nothing on it is a field anybody maintains, and every line is a stamp
 * somebody left while doing their own job — the day the client signed, the
 * day Mitch sent it, the hour Alice raised the PO, the date Duncan committed
 * to, the morning the invoice went out. The gaps are honest too: a job sent
 * before the review queue existed has no hold on it because it never was
 * held.
 *
 * Behind its own grant, because it crosses every area at once. Somebody with
 * Material and nothing else would see all of the money and all of the
 * schedule through this page, so who reads it is a decision somebody makes by
 * name on the Access tab — see `timeline` on Access.
 */

const REFRESH_MS = 120_000;

const C = {
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

/**
 * One colour per part of the business, used nowhere else as a status.
 *
 * Deliberately not the red/amber/green the boards use for lateness: nothing
 * on a timeline is late, because all of it has already happened. These say
 * whose event it was.
 */
const LANES = {
  sales: { label: "Sales", colour: "#7a5ea8" },
  drafting: { label: "Drafting", colour: "#2c6e8f" },
  project: { label: "Project", colour: C.blue },
  handover: { label: "Handover", colour: C.ink },
  review: { label: "Review", colour: C.amber },
  material: { label: "Material", colour: "#8a6d1f" },
  production: { label: "Production", colour: C.green },
  money: { label: "Money", colour: "#8f3f6e" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDay(iso) {
  const day = String(iso || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

/**
 * The time of day, in Brisbane, or "" for a day-only event.
 *
 * Built from the parts rather than from the browser's locale, because the one
 * machine this is read on that is not in Brisbane would otherwise quietly
 * show everybody else's timestamps shifted.
 */
function fmtTime(iso, dayOnly) {
  if (dayOnly) return "";
  const when = new Date(String(iso || ""));
  if (Number.isNaN(when.getTime())) return "";
  const local = new Date(when.getTime() + 10 * 3600_000);
  const h = local.getUTCHours();
  const m = String(local.getUTCMinutes()).padStart(2, "0");
  const ampm = h < 12 ? "am" : "pm";
  return `${((h + 11) % 12) + 1}:${m}${ampm}`;
}

const who = (email) => String(email || "").split("@")[0].replace(/\./g, " ");

export default function TimelinePage() {
  const [signedIn, setSignedIn] = useState(null);
  // The hook takes whoever is signed in and returns the capabilities alone.
  const can = useCapabilities(signedIn);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState({});
  const [lanes, setLanes] = useState([]);

  useEffect(() => {
    if (!firebaseConfigured()) {
      setSignedIn(false);
      return;
    }
    return onAuthStateChanged(auth(), (u) => setSignedIn(Boolean(u)));
  }, []);

  const load = useCallback(async () => {
    if (!firebaseConfigured() || !auth().currentUser) return;
    try {
      const idToken = await auth().currentUser.getIdToken();
      const res = await fetch("/api/timeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(
          json.error === "not_permitted_for_role"
            ? "You haven't been given the Timeline. An admin grants it on the Access tab."
            : errorText(json, "Couldn't load the timeline")
        );
      }
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    load();
    return refreshLoop(load, REFRESH_MS);
  }, [load, signedIn]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const projects = data?.projects ?? [];
    if (!q) return projects;
    return projects.filter((p) =>
      [p.crm, p.client, p.project, p.product, ...p.parts].join(" ").toLowerCase().includes(q)
    );
  }, [data, query]);

  if (signedIn === false) {
    return (
      <Shell>
        <Masthead count={null} tabs={can?.tabs} />
        <SignIn />
      </Shell>
    );
  }
  if (loading && !data) {
    return (
      <Shell>
        <Masthead count={null} tabs={can?.tabs} />
        <p style={{ fontSize: 13, color: C.sub }}>Loading…</p>
      </Shell>
    );
  }
  if (!can.timeline) {
    return (
      <Shell>
        <Masthead count={null} tabs={can?.tabs} />
        <Banner>
          The timeline is granted by name. An admin ticks Timeline against you on the Access tab,
          and it shows every project&apos;s history — the quote, the drawings, the approval, the
          orders, the dates and the invoice — so it is given out one person at a time.
        </Banner>
      </Shell>
    );
  }

  return (
    <Shell>
      <Masthead count={data?.projects?.length ?? null} tabs={can?.tabs} />

      {error && <Banner red>{error}</Banner>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a job, client, project or product"
          style={{
            flex: "1 1 280px",
            minWidth: 0,
            border: `1px solid ${C.line}`,
            borderRadius: 8,
            padding: "9px 12px",
            fontSize: 13,
            fontFamily: "inherit",
            background: "#fff",
          }}
        />
        {/*
          Narrowing by lane rather than by date.

          "Show me only the material" is the question somebody actually has
          when a timeline is long; "show me only October" is not, because they
          are looking for an event whose date is the thing they don't know.
        */}
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {Object.entries(LANES).map(([key, lane]) => {
            const on = lanes.includes(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() =>
                  setLanes((prev) => (on ? prev.filter((l) => l !== key) : [...prev, key]))
                }
                style={{
                  border: `1px solid ${on ? lane.colour : C.line}`,
                  background: on ? lane.colour : "#fff",
                  color: on ? "#fff" : C.sub,
                  borderRadius: 20,
                  padding: "4px 11px",
                  fontSize: 11.5,
                  fontFamily: "inherit",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {lane.label}
              </button>
            );
          })}
          {lanes.length > 0 && (
            <button
              type="button"
              onClick={() => setLanes([])}
              style={{
                border: "none",
                background: "none",
                color: C.sub,
                textDecoration: "underline",
                fontSize: 11.5,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              all
            </button>
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <p style={{ fontSize: 13, color: C.sub }}>
          {query ? `Nothing matching “${query}”.` : "Nothing recorded yet."}
        </p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {shown.map((p) => (
            <Project
              key={p.crm}
              project={p}
              lanes={lanes}
              open={Boolean(open[p.crm])}
              onToggle={() => setOpen((o) => ({ ...o, [p.crm]: !o[p.crm] }))}
            />
          ))}
        </div>
      )}

      <p style={{ fontSize: 11.5, color: C.sub, marginTop: 24, lineHeight: 1.7, maxWidth: 760 }}>
        Every line here is a stamp somebody left while doing their own job — nothing on this page
        is a field anybody maintains, and nothing on it can be changed. Jobs drop off ninety days
        after they finish, the same as on the boards. Production dates were not recorded as events
        before 13 November 2026; older jobs show the last time the schedule row was touched, and
        say so.
      </p>
    </Shell>
  );
}

function Project({ project, lanes, open, onToggle }) {
  const events = lanes.length
    ? project.events.filter((e) => lanes.includes(e.lane))
    : project.events;

  /** By Brisbane day, so a day reads as one block rather than five rows. */
  const days = useMemo(() => {
    const out = [];
    for (const e of events) {
      const last = out[out.length - 1];
      if (last && last.day === e.day) last.events.push(e);
      else out.push({ day: e.day, events: [e] });
    }
    return out;
  }, [events]);

  const last = project.events[project.events.length - 1];

  return (
    <section style={{ border: `1px solid ${C.line}`, background: C.card, borderRadius: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "none",
          padding: "13px 16px",
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          alignItems: "baseline",
        }}
      >
        <span style={{ minWidth: 240, flex: "1 1 340px" }}>
          <span style={{ display: "flex", gap: 9, alignItems: "baseline", flexWrap: "wrap" }}>
            <strong style={{ fontSize: 15, color: C.ink }}>{project.crm}</strong>
            <span style={{ fontSize: 14 }}>{project.client || "—"}</span>
            {project.parts.length > 1 && (
              <span style={{ fontSize: 11, color: C.sub }}>{project.parts.length} parts</span>
            )}
          </span>
          {project.project && (
            <span style={{ display: "block", fontSize: 12, color: C.sub, marginTop: 2 }}>
              {project.project}
            </span>
          )}
          {!open && last && (
            <span style={{ display: "block", fontSize: 11.5, color: C.sub, marginTop: 3 }}>
              Last: {last.label}
              {last.by ? ` — ${who(last.by)}` : ""} · {fmtDay(last.day)}
            </span>
          )}
        </span>

        <span style={{ display: "flex", gap: 16, alignItems: "baseline", flexWrap: "wrap" }}>
          <Stat label="Events" value={project.events.length} />
          <Stat label="Started" value={fmtDay(project.firstAt) || "—"} />
          <Stat
            label={project.away ? "Took" : "Open"}
            value={`${project.spanDays} ${project.spanDays === 1 ? "day" : "days"}`}
          />
          <span
            style={{
              fontSize: 10.5,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              fontWeight: 600,
              borderRadius: 5,
              padding: "3px 9px",
              whiteSpace: "nowrap",
              background: project.away ? "#efece5" : project.state === "Waiting on review" ? "#fdf4e6" : "#eaf2ec",
              color: project.away ? C.sub : project.state === "Waiting on review" ? C.amber : C.green,
            }}
          >
            {project.state}
          </span>
          <span style={{ fontSize: 12, color: C.sub }}>{open ? "▾" : "▸"}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 16px 16px" }}>
          {project.dates.length > 0 && (
            <div
              style={{
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                padding: "9px 12px",
                marginBottom: 14,
                background: "#faf8f4",
              }}
            >
              {/*
                Promised, not happened. Kept out of the list below on purpose:
                a future date in a list of things that have happened is how a
                timeline starts lying.
              */}
              <div style={{ fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.sub, marginBottom: 5 }}>
                Dates promised
              </div>
              <div style={{ display: "grid", gap: 3 }}>
                {project.dates.map((d) => (
                  <div key={d.key} style={{ fontSize: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <span style={{ minWidth: 86, fontWeight: 600 }}>{fmtDay(d.date) || "—"}</span>
                    <span>{d.label}</span>
                    {d.note && <span style={{ color: C.sub }}>{d.note}</span>}
                    {d.by && <span style={{ color: C.sub }}>· {who(d.by)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {days.length === 0 ? (
            <p style={{ fontSize: 12.5, color: C.sub, margin: 0 }}>
              Nothing in {lanes.length === 1 ? LANES[lanes[0]].label.toLowerCase() : "those lanes"} for
              this job.
            </p>
          ) : (
            <div style={{ display: "grid", gap: 2 }}>
              {days.map((group) => (
                <div key={group.day} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                  <div
                    style={{
                      minWidth: 84,
                      flex: "0 0 auto",
                      fontSize: 11.5,
                      color: C.sub,
                      paddingTop: 7,
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmtDay(group.day)}
                  </div>
                  {/*
                    The spine. One continuous line down the day's events, with
                    a dot per event in its own lane's colour — so a job that
                    spent three weeks in material reads as three weeks of one
                    colour without anybody counting rows.
                  */}
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      borderLeft: `2px solid ${C.line}`,
                      paddingLeft: 14,
                      paddingBottom: 6,
                    }}
                  >
                    {group.events.map((e, i) => {
                      const lane = LANES[e.lane] ?? LANES.handover;
                      return (
                        <div key={i} style={{ position: "relative", padding: "5px 0" }}>
                          <span
                            style={{
                              position: "absolute",
                              left: -21,
                              top: 10,
                              width: 9,
                              height: 9,
                              borderRadius: "50%",
                              background: lane.colour,
                              border: "2px solid #fff",
                              boxSizing: "content-box",
                            }}
                          />
                          <div style={{ fontSize: 13, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                            <span style={{ fontWeight: 500 }}>{e.label}</span>
                            {e.jobId && project.parts.length > 1 && (
                              <span style={{ fontSize: 11, color: C.sub }}>{e.jobId}</span>
                            )}
                            {e.by && <span style={{ fontSize: 11.5, color: lane.colour }}>{who(e.by)}</span>}
                            {fmtTime(e.at, e.dayOnly) && (
                              <span style={{ fontSize: 11, color: C.sub, fontVariantNumeric: "tabular-nums" }}>
                                {fmtTime(e.at, e.dayOnly)}
                              </span>
                            )}
                          </div>
                          {e.detail && (
                            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 1, overflowWrap: "anywhere" }}>
                              {e.detail}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span style={{ fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", color: C.sub }}>
        {label}{" "}
      </span>
      <span style={{ fontSize: 12.5 }}>{value}</span>
    </span>
  );
}

function Banner({ children, red }) {
  return (
    <div
      style={{
        border: `1px solid ${red ? C.red : C.line}`,
        background: red ? "#fbeceb" : C.card,
        color: red ? C.red : C.ink,
        borderRadius: 10,
        padding: "12px 15px",
        fontSize: 13,
        lineHeight: 1.65,
        marginBottom: 14,
        maxWidth: 760,
      }}
    >
      {children}
    </div>
  );
}

function Masthead({ count, tabs }) {
  return (
    <>
      <Tabs current="timeline" tabs={tabs} />
      <div style={{ marginTop: HEADER_GAP, marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>Timeline</h1>
        <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
          {count === null
            ? "What happened to every project, and when"
            : `${count} ${count === 1 ? "project" : "projects"} · what happened, and when · most recently touched first`}
        </div>
      </div>
    </>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.ink }}>
      <div style={{ maxWidth: PAGE_WIDTH, margin: "0 auto", padding: `${HEADER_HEIGHT}px 20px 70px` }}>
        {children}
      </div>
    </div>
  );
}
