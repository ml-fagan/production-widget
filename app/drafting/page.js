"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
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
  chasedSinceIssue,
  isAccount,
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
  const markChased = useCallback(async (row) => {
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
        body: JSON.stringify({ taskGid: row.taskGid, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "That didn't save");
      // Whichever record that board keeps. An accounts row gets a comment and
      // a contact date; a drawings row gets the Follow Up date. Taken from the
      // answer rather than guessed at here, so the two can't drift.
      setRows((list) =>
        list.map((r) =>
          r.taskGid === row.taskGid
            ? json.kind === "accounts"
              ? { ...r, lastContactAt: json.lastContactAt, lastContactBy: json.lastContactBy }
              : { ...r, followUpAt: json.followUpAt, chasedBy: json.chasedBy }
            : r
        )
      );
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
              Drafting
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
              <span style={{ marginLeft: 6, opacity: 0.75 }}>{p.count}</span>
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

        {!loading && shown.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {rows.length === 0
              ? "Nothing on the register. That either means every set is back, or the sync hasn't run."
              : "Nothing matches that."}
          </p>
        )}

        {banded.map((band) => (
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
                    <th style={th} title="Drawings: when it was last chased. Accounts: when anybody last spoke to the client.">
                      Chased / contact
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
                    const chased = chasedSinceIssue(r);
                    const account = isAccount(r);
                    return (
                      <tr
                        key={r.taskGid}
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
                        <td style={td}>
                          {account ? (
                            r.lastContactAt ? (
                              <span
                                title={
                                  r.lastContactBy
                                    ? `Last comment by ${r.lastContactBy}`
                                    : "Last comment on the Asana task"
                                }
                              >
                                {shortDay(brisbaneDay(r.lastContactAt))}
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontStyle: "italic",
                                  color: band.urgent ? BRAND.amber : BRAND.sub,
                                }}
                                title="No comment has ever been left on this account"
                              >
                                never
                              </span>
                            )
                          ) : chased ? (
                            shortDay(chased)
                          ) : (
                            <span
                              style={{
                                fontStyle: "italic",
                                color: band.urgent ? BRAND.amber : BRAND.sub,
                              }}
                              title={
                                r.followUpAt
                                  ? `Last chased ${shortDay(r.followUpAt)}, which was before this set went out again`
                                  : "Nobody has recorded chasing this"
                              }
                            >
                              never
                              {/* The old date still shown, because "never"
                                  about a job somebody remembers chasing reads
                                  as the board being wrong. It was chased —
                                  just not since the reissue. */}
                              {r.followUpAt && (
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
                            onClick={() => markChased(r)}
                            disabled={saving === r.taskGid || !canChase}
                            title={
                              !canChase
                                ? "Chasing is Mitch's and the managers'"
                                : account
                                  ? "Adds a comment on the Asana task. Leaves the Follow Up reminder alone."
                                  : "Writes today's date to Follow Up in Asana"
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 18, maxWidth: 820 }}>
          A drawing set lands here when its Asana task is ticked complete, which means issued and
          with the client. Its clock runs from whichever came last, the issue or the chase.
          <br />
          <span style={{ color: BRAND.pink }}>Accounts</span> are never ticked complete, so theirs
          runs on contact instead: the last comment on the task. Their Follow Up dates are reminders
          for a date ahead and are deliberately left alone — pressing Touched base adds a comment
          rather than overwriting one.
        </p>
      </div>
    </main>
  );
}
