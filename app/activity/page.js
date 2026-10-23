"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import { PAGE_WIDTH, HEADER_HEIGHT, HEADER_GAP } from "../../lib/layout.js";

// Activity — who changed what, and when.
//
// Every record stamps who last touched it. None of them kept what a value
// used to be, so "we ordered four and the task says five — did somebody
// change it?" could only be answered by asking everybody. This is the log
// that answers it.
//
// Append-only, and read-only here. A log somebody can edit answers no
// question worth asking.

const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  red: "#a3312c",
  blue: "#004CFB",
};

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
  padding: "6px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  fontSize: 12,
  verticalAlign: "top",
};

const WINDOWS = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "all", label: "Everything", days: null },
];

function when(at) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ActivityPage() {
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [who, setWho] = useState("all");
  const [windowKey, setWindowKey] = useState("7");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/activity", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't read the log");
      setEntries(json.entries || []);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const people = useMemo(
    () => [...new Set(entries.map((e) => e.by).filter(Boolean))].sort(),
    [entries]
  );

  const q = query.trim().toLowerCase();
  const cutoff = useMemo(() => {
    const w = WINDOWS.find((x) => x.key === windowKey);
    if (!w?.days) return null;
    const d = new Date();
    d.setDate(d.getDate() - w.days);
    return d.toISOString();
  }, [windowKey]);

  const shown = entries.filter((e) => {
    if (who !== "all" && e.by !== who) return false;
    if (cutoff && String(e.at) < cutoff) return false;
    if (!q) return true;
    return [e.key, e.label, e.action, e.by, ...(e.changes ?? []).map((c) => c.field)]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });

  if (!firebaseConfigured()) return <SignIn brand={BRAND} note="Firebase isn't configured." />;

  const field = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: "inherit",
    color: BRAND.ink,
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
              Activity
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Who changed what, and when
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            {user ? (
              <div>
                {user.email}{" "}
                <button
                  onClick={() => auth().signOut()}
                  style={{ background: "none", border: "none", color: BRAND.blue, cursor: "pointer", fontSize: 12 }}
                >
                  sign out
                </button>
              </div>
            ) : (
              <div>Sign in to see the log</div>
            )}
            <button
              onClick={load}
              style={{
                border: `1px solid ${BRAND.line}`,
                background: BRAND.card,
                borderRadius: 8,
                padding: "6px 12px",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
                marginTop: 6,
              }}
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs current="activity" tabs={caps.tabs} />

        {error && (
          <div
            style={{
              background: "#fbeceb",
              border: `1px solid ${BRAND.red}`,
              borderRadius: 10,
              padding: "10px 14px",
              margin: "12px 0",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0 12px" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search job, material or action…"
            style={{ ...field, flex: 1, minWidth: 220 }}
          />
          <select value={who} onChange={(e) => setWho(e.target.value)} style={field} aria-label="Filter by person">
            <option value="all">Everybody</option>
            {people.map((p) => (
              <option key={p} value={p}>
                {p.split("@")[0]}
              </option>
            ))}
          </select>
          <select
            value={windowKey}
            onChange={(e) => setWindowKey(e.target.value)}
            style={field}
            aria-label="Filter by date"
          >
            {WINDOWS.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
        </div>

        {!loading && shown.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {entries.length === 0
              ? "Nothing logged yet. The log starts from the day it was switched on — it can't say what happened before that."
              : "Nothing matches that."}
          </p>
        )}

        {shown.length > 0 && (
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
                  <th style={th}>When</th>
                  <th style={th}>Who</th>
                  <th style={th}>Job</th>
                  <th style={th}>What</th>
                  <th style={th}>Changed</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id}>
                    <td style={{ ...td, whiteSpace: "nowrap", color: BRAND.sub }}>{when(e.at)}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>{String(e.by).split("@")[0]}</td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      <a
                        href={`/materials?job=${encodeURIComponent(e.key)}`}
                        style={{ color: BRAND.blue, textDecoration: "none" }}
                      >
                        {e.key}
                      </a>
                    </td>
                    <td style={{ ...td, minWidth: 180 }}>
                      {e.action}
                      {e.label && (
                        <div style={{ fontSize: 11, color: BRAND.sub }}>{e.label}</div>
                      )}
                    </td>
                    <td style={{ ...td, minWidth: 220 }}>
                      {(e.changes ?? []).length === 0 ? (
                        <span style={{ color: "#b3afa6" }}>—</span>
                      ) : (
                        (e.changes ?? []).map((c, i) => (
                          <div key={i} style={{ fontSize: 12 }}>
                            <span style={{ color: BRAND.sub }}>{c.field}</span>{" "}
                            <span style={{ color: "#b3afa6" }}>{c.from}</span>
                            <span style={{ color: BRAND.sub }}> → </span>
                            <strong style={{ fontWeight: 600 }}>{c.to}</strong>
                          </div>
                        ))
                      )}
                      {e.note && (
                        <div style={{ fontSize: 11, color: BRAND.amber, marginTop: 2 }}>{e.note}</div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 16, maxWidth: 820 }}>
          Append-only: nothing here is ever edited or deleted, and the name
          beside each change comes from whoever was signed in rather than from
          the browser. The newest {entries.length} entries are loaded; narrow
          the dates to look further back.
        </p>
      </div>
    </main>
  );
}
