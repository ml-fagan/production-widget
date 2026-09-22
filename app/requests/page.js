"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";

// Requests — what people want these boards to do that they don't.
//
// Most of what's here started as a sentence somebody said while walking past a
// screen. The ones said on a busy day were never said again, and the ones said
// twice got built. This is that conversation written down: anyone raises one,
// everyone can read them, and a manager answers.
//
// Deliberately not email. Another inbox is another thing to ignore; a request
// lands on a tab with a count on it, the same way work does.

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

const STATUS = {
  new: { label: "New", colour: "#a86b12" },
  planned: { label: "Planned", colour: "#004CFB" },
  done: { label: "Done", colour: "#408152" },
  declined: { label: "Not doing", colour: "#6b6862" },
};

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  // Answering is a manager's; raising one is anybody's, which is the point.
  const canAnswer = caps.manage;
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [reply, setReply] = useState("");
  const [showDone, setShowDone] = useState(false);
  // Deleting is one click away, not none — the second click is the answer to
  // "did you mean that one?"
  const [confirmDelete, setConfirmDelete] = useState(null);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/requests", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load requests");
      setRequests(json.requests || []);
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

  const send = useCallback(async (payload) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first, so we know who to come back to.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      await load();
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [load]);

  const open = requests.filter((r) => r.status !== "done" && r.status !== "declined");
  const closed = requests.filter((r) => r.status === "done" || r.status === "declined");
  const shown = showDone ? closed : open;

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
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Request a change
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              About these screens, not the work on them — anything you want them to do that they
              don&apos;t. Michael reads them.
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs tabs={caps.tabs} current="requests" counts={{ requests: open.length }} />

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
            Couldn&apos;t load requests. {error}
          </div>
        )}

        {/* The box comes first: the whole thing fails if raising one is a
            journey. Type it, send it, carry on. */}
        <div
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            padding: 14,
            marginBottom: 20,
          }}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What would make this easier? A button in the wrong place, a number you can't see, something you're still writing down twice…"
            style={{
              width: "100%",
              border: `1px solid ${BRAND.line}`,
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 14,
              fontFamily: "inherit",
              boxSizing: "border-box",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button
              onClick={async () => {
                const ok = await send({ action: "raise", text });
                if (ok) setText("");
              }}
              disabled={saving || !text.trim()}
              style={{
                ...btn,
                background: BRAND.green,
                borderColor: BRAND.green,
                color: "#fff",
                padding: "7px 16px",
                fontSize: 13,
                opacity: saving || !text.trim() ? 0.6 : 1,
              }}
            >
              {saving ? "Sending…" : "Send it"}
            </button>
            <span style={{ fontSize: 12, color: BRAND.sub }}>
              It goes on the list below with your name on it — everyone can see what&apos;s been
              asked for, so nobody asks twice.
            </span>
          </div>
        </div>

        <div style={{ display: "flex", gap: 18, marginBottom: 12, alignItems: "baseline" }}>
          <button
            onClick={() => setShowDone(false)}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: showDone ? 400 : 600,
              color: showDone ? "#9c988f" : BRAND.ink,
            }}
          >
            Open ({open.length})
          </button>
          <button
            onClick={() => setShowDone(true)}
            style={{
              border: "none",
              background: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              fontWeight: showDone ? 600 : 400,
              color: showDone ? BRAND.ink : "#9c988f",
            }}
          >
            Answered ({closed.length})
          </button>
        </div>

        {!loading && shown.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {showDone ? "Nothing answered yet." : "Nothing outstanding — the box above is empty and so is the list."}
          </p>
        )}

        {shown.map((r) => {
          const status = STATUS[r.status] || STATUS.new;
          const closedStatus = r.status === "done" || r.status === "declined";
          return (
            <section
              key={r.id}
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderLeft: `3px solid ${status.colour}`,
                borderRadius: 10,
                padding: "12px 14px",
                marginBottom: 10,
              }}
            >
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: status.colour }}>
                  {status.label.toUpperCase()}
                </span>
                <span style={{ fontSize: 12, color: BRAND.sub }}>
                  {r.raisedBy ? r.raisedBy.split("@")[0] : "someone"} · {fmtStamp(r.raisedAt)}
                  {r.screen ? ` · ${r.screen}` : ""}
                </span>
              </div>
              <p style={{ fontSize: 14, margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{r.text}</p>

              {r.reply && (
                <p
                  style={{
                    fontSize: 13,
                    margin: "8px 0 0",
                    padding: "8px 10px",
                    background: BRAND.bg,
                    borderRadius: 8,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  <strong style={{ color: BRAND.sub, fontSize: 11 }}>
                    {r.answeredBy ? r.answeredBy.split("@")[0] : "answer"}
                    {r.answeredAt ? ` · ${fmtStamp(r.answeredAt)}` : ""}
                  </strong>
                  <br />
                  {r.reply}
                </p>
              )}

              {canAnswer && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
                  {replyTo === r.id ? (
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "flex-start",
                        flexWrap: "wrap",
                        width: "100%",
                      }}
                    >
                      <input
                        autoFocus
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="Say what's happening with it"
                        style={{
                          flex: 1,
                          minWidth: 220,
                          border: `1px solid ${BRAND.line}`,
                          borderRadius: 8,
                          padding: "6px 10px",
                          fontSize: 13,
                          fontFamily: "inherit",
                        }}
                      />
                      {["planned", "done", "declined"].map((s) => (
                        <button
                          key={s}
                          onClick={async () => {
                            const ok = await send({ action: "answer", id: r.id, status: s, reply });
                            if (ok) {
                              setReplyTo(null);
                              setReply("");
                            }
                          }}
                          disabled={saving}
                          style={{ ...btn, color: STATUS[s].colour, borderColor: STATUS[s].colour }}
                        >
                          {STATUS[s].label}
                        </button>
                      ))}
                      <button onClick={() => setReplyTo(null)} style={btn}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setReplyTo(r.id);
                          setReply(r.reply || "");
                          setConfirmDelete(null);
                        }}
                        style={{ ...btn, color: BRAND.blue }}
                      >
                        Answer
                      </button>
                      {/* Only once it's been dealt with. An open request is
                          somebody still waiting on you. */}
                      {closedStatus &&
                        (confirmDelete === r.id ? (
                          <>
                            <span style={{ fontSize: 12, color: BRAND.sub, alignSelf: "center" }}>
                              Clear it for good?
                            </span>
                            <button
                              onClick={async () => {
                                const ok = await send({ action: "delete", id: r.id });
                                if (ok) setConfirmDelete(null);
                              }}
                              disabled={saving}
                              style={{ ...btn, color: BRAND.red, borderColor: BRAND.red }}
                            >
                              {saving ? "Clearing…" : "Yes, delete"}
                            </button>
                            <button onClick={() => setConfirmDelete(null)} style={btn}>
                              Keep it
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(r.id)}
                            style={{ ...btn, color: BRAND.sub }}
                          >
                            Delete
                          </button>
                        ))}
                    </>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
