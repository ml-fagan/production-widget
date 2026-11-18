"use client";

import { useMemo, useState } from "react";
import { auth } from "../../lib/firebaseClient.js";

/**
 * The days the factory is shut, and the control for saying so.
 *
 * The lead on every row is the span from the client approving to the date the
 * job is committed to. Across a three-week Christmas shutdown that span reads
 * as twelve weeks of work when nine of them were work and three were nobody
 * being here — and that inflated figure is what the forecast's median is built
 * from and what a client is told to expect.
 *
 * So the shutdowns are typed once, here, and come out of every lead on the
 * board. A year nobody fills in has no closedowns and the leads read exactly
 * as they always did; nothing infers a shutdown and nothing expires one.
 *
 * Duncan's, under the same right that sets committed dates: shutting the
 * factory for three weeks moves every promise that crosses it.
 */

const BRAND = {
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  red: "#a3312c",
};

const input = {
  border: `1px solid ${BRAND.line}`,
  borderRadius: 6,
  padding: "5px 7px",
  fontSize: 12,
  color: BRAND.ink,
  background: "#fff",
};

/** "22 Dec 26" — short enough to sit three to a line. */
function fmt(day) {
  const d = new Date(`${day}T00:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "2-digit" });
}

/** Calendar days in a period, both ends counted — what it takes off a lead. */
function spanDays(c) {
  const from = Date.parse(`${c.from}T00:00:00Z`);
  const to = Date.parse(`${c.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86400000) + 1;
}

export default function Closedowns({ closedowns, canEdit, onChanged }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const today = new Date().toISOString().slice(0, 10);

  /* Past shutdowns still matter — they are what made an old lead what it is —
     but the one worth seeing on the button is the next one coming. */
  const next = useMemo(
    () => [...(closedowns || [])].sort((a, b) => a.from.localeCompare(b.from)).find((c) => c.to >= today),
    [closedowns, today]
  );

  const sorted = useMemo(
    () => [...(closedowns || [])].sort((a, b) => b.from.localeCompare(a.from)),
    [closedowns]
  );

  async function send(payload) {
    setError("");
    try {
      const idToken = await auth()?.currentUser?.getIdToken();
      const res = await fetch("/api/closedowns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't save that");
      onChanged?.(json.closedowns || []);
      return true;
    } catch (e) {
      setError(String(e.message || e));
      return false;
    }
  }

  async function add(e) {
    e.preventDefault();
    setBusy("add");
    const ok = await send({ action: "add", name, from, to: to || from });
    setBusy("");
    if (ok) {
      setName("");
      setFrom("");
      setTo("");
    }
  }

  async function remove(c) {
    /* No confirm: it is two dates and a name, it is instantly retypable, and
       the only thing it changes is a figure that goes back to what it was. */
    setBusy(c.id);
    await send({ action: "remove", id: c.id });
    setBusy("");
  }

  return (
    <div className="no-print" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Days the factory is shut — taken out of every lead on this board"
        style={{
          border: `1px solid ${BRAND.line}`,
          background: open ? "#f5f3ef" : "#fff",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: BRAND.ink,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Closedowns
        <span style={{ color: BRAND.sub }}>
          {next ? ` · next ${next.name} ${fmt(next.from)}` : " · none set"}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 20,
            width: 360,
            background: BRAND.card,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.10)",
            padding: 12,
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 12, color: BRAND.sub, lineHeight: 1.45 }}>
            Days the factory is shut. These come out of the lead on every row, so a job
            approved in December and committed to in January doesn&apos;t read as twelve
            weeks of work over Christmas.
          </p>

          {sorted.length === 0 ? (
            <p style={{ margin: "0 0 10px", fontSize: 12, color: BRAND.sub }}>
              Nothing set — leads are the plain span between the two dates.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0 }}>
              {sorted.map((c) => {
                const past = c.to < today;
                return (
                  <li
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "5px 0",
                      borderTop: `1px solid ${BRAND.line}`,
                      fontSize: 12,
                      color: past ? BRAND.sub : BRAND.ink,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{c.name || "Unnamed"}</span>
                    <span style={{ color: BRAND.sub }}>
                      {fmt(c.from)} – {fmt(c.to)} · {spanDays(c)} days
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        disabled={busy === c.id}
                        onClick={() => remove(c)}
                        style={{
                          marginLeft: "auto",
                          border: "none",
                          background: "none",
                          color: BRAND.red,
                          fontSize: 11,
                          cursor: "pointer",
                          textDecoration: "underline",
                          opacity: busy === c.id ? 0.5 : 1,
                        }}
                      >
                        remove
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit ? (
            <form onSubmit={add} style={{ borderTop: `1px solid ${BRAND.line}`, paddingTop: 10 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Christmas 2026"
                required
                style={{ ...input, width: "100%", marginBottom: 6 }}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  required
                  style={{ ...input, flex: 1 }}
                  title="First day shut"
                />
                <span style={{ fontSize: 12, color: BRAND.sub }}>to</span>
                <input
                  type="date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => setTo(e.target.value)}
                  style={{ ...input, flex: 1 }}
                  title="Last day shut — leave blank for a single day"
                />
                <button
                  type="submit"
                  disabled={busy === "add" || !name.trim() || !from}
                  style={{
                    border: "none",
                    background: BRAND.green,
                    color: "#fff",
                    borderRadius: 6,
                    padding: "6px 12px",
                    fontSize: 12,
                    cursor: "pointer",
                    opacity: busy === "add" || !name.trim() || !from ? 0.5 : 1,
                  }}
                >
                  Add
                </button>
              </div>
              <p style={{ margin: "6px 0 0", fontSize: 11, color: BRAND.sub }}>
                Both days counted. One day shut: leave the second date blank.
              </p>
            </form>
          ) : (
            <p
              style={{
                margin: 0,
                borderTop: `1px solid ${BRAND.line}`,
                paddingTop: 8,
                fontSize: 11,
                color: BRAND.sub,
              }}
            >
              Set by whoever commits the dates — it moves every promise that crosses it.
            </p>
          )}

          {error && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: BRAND.red }}>{error}</p>
          )}
        </div>
      )}
    </div>
  );
}
