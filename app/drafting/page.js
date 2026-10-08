"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import Overview from "./Overview.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import {
  BANDS,
  bandOf,
  quietDays,
  today,
  shortDay,
  brisbaneDay,
  timesOutLabel,
  pillsFor,
  matchesPill,
  csvFor,
  plain,
  clockFrom,
  isAccount,
  groupByJob,
} from "../../lib/drafting.js";

// Drafting — drawings issued and sitting with a client.
//
// A job lands here when Mitch ticks its task complete in Asana, which he means
// as "issued, with the client". He unticks it when a revision comes back and
// reticks it when he reissues, so a job can be out several times and the clock
// restarts each time.
//
// Asana owns this. The register is a cache so the board renders in one read,
// and the only thing that ever gets written back is the Follow Up date.
//
// Thirty-six of the forty-one rows have never been chased, and the oldest has
// been quiet for two hundred and twenty days. That is the whole reason for the
// board: none of this was visible anywhere.

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
  // Accounts. Pink so the two halves of the board are told apart at a glance
  // without reading a column — they answer different questions and the action
  // on them is different.
  pink: "#a8336d",
  pinkSoft: "#fdf2f7",
};

const REFRESH_MS = 15 * 60 * 1000;

function pollWhenVisible(run, everyMs) {
  const id = setInterval(() => {
    if (!document.hidden) run();
  }, everyMs);
  return id;
}

export default function DraftingPage() {
  const [rows, setRows] = useState([]);
  const [syncedAt, setSyncedAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState("all");
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  // Chasing is Mitch's and the managers'; reading is anyone's.
  const canChase = caps.drafting;
  const [saving, setSaving] = useState("");
  const [actionError, setActionError] = useState(null);
  // Which row has its note open, and what's been typed into it. One at a time:
  // two half-written notes on screen is a way to put one on the wrong job.
  const [noting, setNoting] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/drafting", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't read the register");
      setRows(json.rows || []);
      setSyncedAt(json.syncedAt || "");
      setError(null);
    } catch (e) {
      // Deliberately keeps whatever was already on screen. An empty chase
      // register reads as "nothing to chase", which is the worst thing this
      // board could say.
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = pollWhenVisible(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  /**
   * Recording a chase.
   *
   * The row moves band straight away rather than waiting an hour for the next
   * sync — the server writes Asana first and the cache second, so by the time
   * this answers the date is real everywhere.
   */
  const markChased = useCallback(async (row, note = "") => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first — a chase is recorded against a name.");
      return;
    }
    setSaving(row.taskGid);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/drafting/chased", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskGid: row.taskGid, idToken, note }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "That didn't save");
      // Whichever record that board keeps. An accounts row gets a comment and
      // a contact date; a drawings row gets the Follow Up date and, now, a
      // comment as well. Taken from the answer rather than guessed at here, so
      // the two can't drift — and lastContactAt only arrives if the comment
      // really posted.
      setRows((list) =>
        list.map((r) =>
          r.taskGid === row.taskGid
            ? json.kind === "accounts"
              ? { ...r, lastContactAt: json.lastContactAt, lastContactBy: json.lastContactBy }
              : {
                  ...r,
                  followUpAt: json.followUpAt,
                  chasedBy: json.chasedBy,
                  ...(json.lastContactAt
                    ? { lastContactAt: json.lastContactAt, lastContactBy: json.lastContactBy }
                    : {}),
                }
            : r
        )
      );
      // A note that was typed but didn't reach Asana must say so. The chase
      // itself is recorded either way.
      if (note.trim() && !json.lastContactAt && json.kind !== "accounts") {
        setActionError("Chase recorded, but the note didn't post to Asana. Add it there by hand.");
      }
      setNoting("");
      setNote("");
    } catch (e) {
      setActionError(String(e.message || e));
    } finally {
      setSaving("");
    }
  }, []);

  const now = today();
  // Normalised, because the names carry non-breaking spaces that no keyboard
  // produces — see plain().
  const q = plain(query).toLowerCase();

  const shown = useMemo(
    () =>
      rows
        .filter((r) => matchesPill(r, pill))
        .filter(
          (r) =>
            !q ||
            plain([r.crm, r.projectName, r.assignee, r.products].filter(Boolean).join(" "))
              .toLowerCase()
              .includes(q)
        )
        .map((r) => ({ ...r, days: quietDays(r, now) }))
        // Longest quiet first within whatever band it lands in.
        .sort((a, b) => (b.days ?? -1) - (a.days ?? -1)),
    [rows, pill, q, now]
  );

  const pills = useMemo(() => pillsFor(rows, now), [rows, now]);
  const banded = BANDS.map((band) => ({
    ...band,
    rows: shown.filter((r) => bandOf(r.days) === band.key),
  })).filter((b) => b.rows.length > 0);

  const aged = rows.filter((r) => bandOf(quietDays(r, now)) === "aged").length;
  const accountsCount = rows.filter(isAccount).length;
  const drawingsCount = rows.length - accountsCount;

  /**
   * Which rows belong to the same job.
   *
   * Built from every row, not the filtered ones — a drawing set's account
   * still has to be reported when the filter is showing drawings only, which
   * is exactly when somebody would otherwise assume it isn't there.
   */
  const jobs = useMemo(() => groupByJob(rows), [rows]);
  // Counted over distinct groups, not over rows: the index holds one entry
  // per task, so every member of a pair would otherwise count it again.
  const sharedJobs = useMemo(
    () => new Set([...jobs.values()].filter((g) => g.length > 1)).size,
    [jobs]
  );

  /**
   * The board, as a spreadsheet.
   *
   * Exports what's on screen, filter and search included, and names the file
   * for the day it was taken — a drafting export is a snapshot of a clock, and
   * two of them a week apart are only comparable if you can tell them apart.
   *
   * The BOM is for Excel, which otherwise reads UTF-8 as the system codepage
   * and turns every dash in a project name into mojibake.
   */
  const exportCsv = () => {
    const text = `﻿${csvFor(shown, now)}`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `drafting-${now}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const th = {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 500,
    color: BRAND.sub,
    padding: "7px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };
  const td = {
    fontSize: 12,
    padding: "7px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };
  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "5px 12px",
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
        padding: 24,
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1500, margin: "0 auto" }}>
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
              Tasks
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {drawingsCount} {drawingsCount === 1 ? "set" : "sets"} out with clients
              {accountsCount > 0 && (
                <>
                  {" · "}
                  <span style={{ color: BRAND.pink }}>{accountsCount} accounts</span>
                </>
              )}
              {aged > 0 && (
                <>
                  {" · "}
                  <strong style={{ color: BRAND.amber }}>{aged} quiet over a month</strong>
                </>
              )}
              {sharedJobs > 0 && (
                <>
                  {" · "}
                  <span title="Jobs with both a drawing set and an account on the board. Both are shown — they are different stages, with different people on them.">
                    {sharedJobs} on both sides
                  </span>
                </>
              )}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Reading…" : "Refresh"}
            </button>
            {/* The age of the cache rather than the time of day: a register
                that has stopped syncing should look stopped, not look quiet. */}
            <div style={{ marginTop: 6 }}>
              {syncedAt ? `From Asana ${shortDay(brisbaneDay(syncedAt))}` : ""}
            </div>
          </div>
        </header>

        <Tabs current="drafting" tabs={caps.tabs} />

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
              border: `1px solid ${BRAND.red}`,
              color: BRAND.red,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t reach the register, so this is the last good copy —
            not an empty list. {error}
          </div>
        )}

        {/* Filters, built from the rows: a new drafter appears the day they're
            assigned something rather than the day somebody edits a file. */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {pills.map((p) => (
            <button
              key={p.key}
              onClick={() => setPill(p.key)}
              style={{
                ...btn,
                background: pill === p.key ? BRAND.ink : BRAND.card,
                borderColor: pill === p.key ? BRAND.ink : BRAND.line,
                color: pill === p.key ? "#fff" : BRAND.sub,
              }}
            >
              {p.label}
              {p.count !== null && <span style={{ marginLeft: 6, opacity: 0.75 }}>{p.count}</span>}
            </button>
          ))}
          {shown.length > 0 && (
            <button
              onClick={exportCsv}
              style={{ ...btn, marginLeft: "auto", color: BRAND.blue }}
              title="Exports the rows you're looking at, not the whole register"
            >
              Export CSV
            </button>
          )}
        </div>

        {/* The board totalled rather than listed. Its own view, not a filter:
            the rows underneath would only repeat it. */}
        {pill === "overview" && (
          <Overview
            rows={rows}
            now={now}
            brand={BRAND}
            onPickPerson={(who) => setPill(`who:${who}`)}
          />
        )}

        {pill !== "overview" && (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by job, project, person or product"
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
        )}

        {pill !== "overview" && !loading && shown.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {rows.length === 0
              ? "Nothing on the register. That either means every set is back, or the sync hasn't run."
              : "Nothing matches that."}
          </p>
        )}

        {pill !== "overview" && banded.map((band) => (
          <section
            key={band.key}
            style={{
              background: BRAND.card,
              border: `1px solid ${band.urgent ? BRAND.amber : BRAND.line}`,
              borderRadius: 10,
              marginBottom: 14,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                padding: "9px 12px",
                background: band.urgent ? "#fdf4e6" : "transparent",
                borderBottom: `1px solid ${BRAND.line}`,
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: band.urgent ? BRAND.amber : BRAND.ink,
                }}
              >
                {band.label} ({band.rows.length})
              </span>
              {band.hint && (
                <span style={{ fontSize: 11, color: BRAND.sub }}>{band.hint}</span>
              )}
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, textAlign: "right" }}>Quiet</th>
                    <th style={th}>Job</th>
                    <th style={th}>Project</th>
                    <th style={th}>Owner</th>
                    <th style={th}>Product</th>
                    <th style={th}>Issued</th>
                    <th style={th} title="How many times this set has gone out">
                      Times out
                    </th>
                    <th
                      style={th}
                      title="The last time anybody was in touch — a recorded chase, or a comment on the Asana task"
                    >
                      Last touch
                    </th>
                    <th style={{ ...th, textAlign: "right" }} />
                  </tr>
                </thead>
                <tbody>
                  {band.rows.map((r) => {
                    const times = timesOutLabel(r);
                    // What the quiet count is measured from, so the number can
                    // always be explained without opening Asana.
                    const clock = clockFrom(r);
                    const account = isAccount(r);
                    const open = noting === r.taskGid;
                    // The other stages of this job, so a row can say what the
                    // rest of it is doing instead of pretending to be alone.
                    const siblings = (jobs.get(r.taskGid) || []).filter(
                      (s) => s.taskGid !== r.taskGid
                    );
                    return (
                      <Fragment key={r.taskGid}>
                      <tr
                        style={
                          account
                            ? { background: BRAND.pinkSoft, boxShadow: `inset 3px 0 0 ${BRAND.pink}` }
                            : undefined
                        }
                      >
                        {/* The largest thing on the row, because it's the
                            only number that decides anything. */}
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontSize: 17,
                            fontWeight: 600,
                            color: band.urgent ? BRAND.amber : BRAND.ink,
                          }}
                          title={
                            clock.basis === "chased"
                              ? `Since it was chased, on ${shortDay(clock.day)}`
                              : clock.basis === "issued"
                                ? `Since it was last issued, on ${shortDay(clock.day)}`
                                : clock.basis === "contacted"
                                  ? `Since anybody last spoke to the client, on ${shortDay(clock.day)}`
                                  : clock.basis === "opened"
                                    ? `Nobody has ever recorded contact. Counting from when the account was opened, on ${shortDay(clock.day)}`
                                    : "No date to count from"
                          }
                        >
                          {r.days === null ? "—" : r.days}
                          <span style={{ fontSize: 11, fontWeight: 400, color: BRAND.sub }}>d</span>
                        </td>
                        <td style={{ ...td, fontWeight: 600 }}>
                          {/* A task whose name carries no number still belongs
                              here — dropping it because a parse failed would
                              hide the row somebody needs. */}
                          {r.crm || <span style={{ color: BRAND.sub, fontWeight: 400 }}>—</span>}
                          {account && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                letterSpacing: "0.03em",
                                color: BRAND.pink,
                                border: `1px solid ${BRAND.pink}`,
                                borderRadius: 4,
                                padding: "1px 4px",
                                verticalAlign: "middle",
                              }}
                              title="From 1. Accounts — the clock runs on contact with the client"
                            >
                              ACCT
                            </span>
                          )}
                          {/* The rest of the job. Both rows stay on the board;
                              this is so neither has to be read as the whole
                              story. Clicking filters to the job. */}
                          {siblings.length > 0 && (
                            <div style={{ marginTop: 3 }}>
                              {siblings.map((s) => {
                                const sd = quietDays(s, now);
                                const sAcct = isAccount(s);
                                return (
                                  <button
                                    key={s.taskGid}
                                    onClick={() => setQuery(s.crm || s.projectName || "")}
                                    title={`Also on this job: ${s.projectName}${
                                      s.assignee ? ` (${s.assignee})` : ""
                                    } — ${sd === null ? "no date" : `${sd} days quiet`}. Click to show it.`}
                                    style={{
                                      border: "none",
                                      background: "transparent",
                                      padding: 0,
                                      marginRight: 6,
                                      fontSize: 10,
                                      fontWeight: 500,
                                      fontFamily: "inherit",
                                      cursor: "pointer",
                                      color: sAcct ? BRAND.pink : BRAND.green,
                                      textDecoration: "underline dotted",
                                    }}
                                  >
                                    +{sAcct ? "acct" : "draw"}{" "}
                                    <span
                                      style={{
                                        color: bandOf(sd) === "aged" ? BRAND.amber : "inherit",
                                        fontWeight: bandOf(sd) === "aged" ? 700 : 500,
                                      }}
                                    >
                                      {sd === null ? "—" : `${sd}d`}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td style={{ ...td, whiteSpace: "normal", minWidth: 220 }}>
                          {r.projectName || "—"}
                        </td>
                        <td style={td}>{r.assignee || "—"}</td>
                        <td style={{ ...td, whiteSpace: "normal", maxWidth: 200 }}>
                          {r.products || <span style={{ color: BRAND.sub }}>—</span>}
                        </td>
                        {/* Accounts are never issued and never completed, so
                            both of these columns are empty for them by
                            definition rather than for want of data. */}
                        <td style={{ ...td, color: BRAND.sub }}>
                          {account ? (
                            <span style={{ color: "#b3afa6" }} title="Accounts aren't issued">
                              —
                            </span>
                          ) : (
                            shortDay(brisbaneDay(r.completedAt)) || "—"
                          )}
                        </td>
                        <td style={{ ...td, color: times.repeat ? BRAND.ink : BRAND.sub }}>
                          {/* Blank until this row ages into needing the
                              revision history fetched — not an error state. */}
                          {account || r.timesOut === null || r.timesOut === undefined ? (
                            <span style={{ color: "#b3afa6" }}>—</span>
                          ) : (
                            times.text
                          )}
                        </td>
                        {/* The last time anybody was in touch, however it was
                            recorded: a chase, or somebody leaving a comment.
                            Read off the clock, so this column and the day
                            count can never tell different stories. */}
                        <td style={td}>
                          {clock.basis === "chased" || clock.basis === "contacted" ? (
                            <span
                              title={
                                clock.basis === "chased"
                                  ? `Chased on ${shortDay(clock.day)}`
                                  : r.lastContactBy
                                    ? `Last comment, by ${r.lastContactBy}`
                                    : "Last comment on the Asana task"
                              }
                            >
                              {shortDay(clock.day)}
                              {clock.basis === "contacted" && (
                                <span
                                  style={{ color: "#b3afa6", fontSize: 11, marginLeft: 5 }}
                                >
                                  comment
                                </span>
                              )}
                            </span>
                          ) : (
                            <span
                              style={{
                                fontStyle: "italic",
                                color: band.urgent ? BRAND.amber : BRAND.sub,
                              }}
                              title={
                                account
                                  ? "No comment has ever been left on this account"
                                  : r.followUpAt
                                    ? `Last chased ${shortDay(r.followUpAt)}, which was before this set went out again`
                                    : "Nobody has chased this or commented on it"
                              }
                            >
                              never
                              {/* The old date still shown, because "never"
                                  about a job somebody remembers chasing reads
                                  as the board being wrong. It was chased —
                                  just not since the reissue. */}
                              {!account && r.followUpAt && (
                                <span
                                  style={{
                                    fontStyle: "normal",
                                    color: "#b3afa6",
                                    fontSize: 11,
                                    marginLeft: 5,
                                  }}
                                >
                                  last {shortDay(r.followUpAt)}
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                          <button
                            onClick={() => {
                              setNote("");
                              setNoting(noting === r.taskGid ? "" : r.taskGid);
                            }}
                            disabled={saving === r.taskGid || !canChase}
                            title={
                              !canChase
                                ? "Chasing is Mitch's and the managers'"
                                : account
                                  ? "Write what came of it. Posts a comment on the Asana task and leaves the Follow Up reminder alone."
                                  : "Write what came of it. Sets Follow Up to today and posts a comment on the Asana task."
                            }
                            style={{
                              ...btn,
                              marginRight: 8,
                              // Pink on an account, so the button that does a
                              // different thing doesn't look identical.
                              background: canChase ? (account ? BRAND.pink : BRAND.green) : BRAND.card,
                              borderColor: canChase ? (account ? BRAND.pink : BRAND.green) : BRAND.line,
                              color: canChase ? "#fff" : BRAND.sub,
                              opacity: saving === r.taskGid ? 0.6 : 1,
                            }}
                          >
                            {saving === r.taskGid
                              ? "Saving…"
                              : account
                                ? "Touched base"
                                : "Chased today"}
                          </button>
                          {r.permalink && (
                            <a
                              href={r.permalink}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: BRAND.blue, textDecoration: "none", fontSize: 12 }}
                            >
                              Asana ↗
                            </a>
                          )}
                        </td>
                      </tr>

                      {/* The note, in a row of its own beneath — so opening it
                          never changes the shape of the row above, and the
                          box is wide enough to write a sentence in. */}
                      {open && (
                        <tr style={account ? { background: BRAND.pinkSoft } : undefined}>
                          <td colSpan={9} style={{ ...td, whiteSpace: "normal", padding: "10px 12px" }}>
                            {/* Pinned to the left edge of the scroll window and
                                held to a readable width. The cell spans all
                                nine columns, so without this the Post button
                                sits wherever the table happens to end — which
                                on a laptop is off the right-hand side, leaving
                                a note you can type and cannot send. */}
                            <div
                              style={{
                                position: "sticky",
                                left: 0,
                                maxWidth: 820,
                                display: "flex",
                                gap: 8,
                                alignItems: "flex-start",
                              }}
                            >
                              <textarea
                                autoFocus
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                maxLength={2000}
                                rows={2}
                                placeholder={`What came of it? e.g. "Called and left a message." — goes on the Asana task for ${r.crm || "this job"}`}
                                onKeyDown={(e) => {
                                  // Ctrl/Cmd+Enter to send, Escape to drop it.
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                    e.preventDefault();
                                    markChased(r, note);
                                  }
                                  if (e.key === "Escape") {
                                    setNoting("");
                                    setNote("");
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  border: `1px solid ${BRAND.line}`,
                                  borderRadius: 8,
                                  padding: "8px 10px",
                                  fontSize: 13,
                                  fontFamily: "inherit",
                                  resize: "vertical",
                                  background: BRAND.card,
                                  color: BRAND.ink,
                                }}
                              />
                              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <button
                                  onClick={() => markChased(r, note)}
                                  disabled={saving === r.taskGid}
                                  style={{
                                    ...btn,
                                    background: account ? BRAND.pink : BRAND.green,
                                    borderColor: account ? BRAND.pink : BRAND.green,
                                    color: "#fff",
                                    opacity: saving === r.taskGid ? 0.6 : 1,
                                  }}
                                >
                                  {saving === r.taskGid
                                    ? "Posting…"
                                    : note.trim()
                                      ? "Post to Asana"
                                      : "Record without a note"}
                                </button>
                                <button
                                  onClick={() => {
                                    setNoting("");
                                    setNote("");
                                  }}
                                  disabled={saving === r.taskGid}
                                  style={btn}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                            <p
                              style={{
                                position: "sticky",
                                left: 0,
                                maxWidth: 820,
                                fontSize: 11,
                                color: BRAND.sub,
                                margin: "6px 0 0",
                              }}
                            >
                              {account
                                ? "Posts a comment on the Asana task. The Follow Up reminder is left alone."
                                : "Sets Follow Up to today and posts a comment on the Asana task."}{" "}
                              Asana stamps it with the time, so the comment is the record of when you
                              followed up. ⌘/Ctrl + Enter to post.
                            </p>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18, maxWidth: 820 }}>
          Every row counts from the last real thing that happened to it — the drawings going out,
          somebody chasing, or anybody leaving a comment on the Asana task. A set lands here when
          its task is ticked complete, which means issued and with the client.
          <br />
          <span style={{ color: BRAND.pink }}>Accounts</span> are never ticked complete, so they
          have no issue date and run on contact alone. Their Follow Up dates are reminders for a
          date ahead and are deliberately left alone — pressing Touched base adds a comment rather
          than overwriting one.
        </p>
      </div>
    </main>
  );
}
