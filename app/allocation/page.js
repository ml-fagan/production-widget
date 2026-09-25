"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import {
  SLOTS,
  workingDay,
  clock,
  atTime,
  isOpen,
  hoursOf,
  fmtHours,
  onSlot,
  closedOnSlot,
  mannedHours,
  bookedJob,
  summarise,
  daysBefore,
} from "../../lib/allocation.js";

// Allocation — who is on which machine today.
//
// Adam's board. A machine has six lines under it; a line holds one person at a
// time, with the times they started and finished. Moving somebody closes one
// segment and opens the next, so the day's history is the record rather than
// something built on top of it.
//
// What it is not is a time and wages record. The factory already clocks in and
// out; this says where people were, and the day line reads the two against
// each other rather than replacing one with the other.

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

// A board somebody is working from all morning, refreshed often enough to be
// worth looking at. Still paused while the tab is hidden.
const REFRESH_MS = 60 * 1000;

function pollWhenVisible(run, everyMs) {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    run();
  }, everyMs);
}

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
const miniBtn = { ...btn, padding: "2px 8px", fontSize: 11, borderRadius: 6 };

export default function AllocationPage() {
  const [day, setDay] = useState(workingDay());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const canAllocate = caps.allocation;
  // Which empty slot is being filled, as "machineId:slot".
  const [filling, setFilling] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  // Open segments are measured to now, so the clock has to move or the hours
  // freeze at whatever they were when the page loaded.
  useEffect(() => {
    const id = pollWhenVisible(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/allocation?date=${day}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load the day");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, [day]);

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

  const send = useCallback(
    async (payload) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first — an allocation has a name on it.");
        return false;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/allocation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "That didn't save");
        await load();
        return true;
      } catch (e) {
        setActionError(String(e.message || e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  const machines = data?.machines ?? [];
  const people = data?.people ?? [];
  const allocations = useMemo(
    () => (data?.allocations ?? []).filter((a) => a.date === day),
    [data, day]
  );
  const punches = useMemo(() => (data?.punches ?? []).filter((p) => p.date === day), [data, day]);
  const bookings = data?.bookings ?? [];
  const nameOf = useCallback(
    (personId) => people.find((p) => p.id === personId)?.name || "—",
    [people]
  );

  const day_ = summarise(allocations, punches, now);
  // Anyone with nothing open — the strip along the top is "who's spare", which
  // is the question Adam is asking when he looks at it.
  const placed = new Set(allocations.filter(isOpen).map((a) => a.personId));
  const spare = people.filter((p) => !placed.has(p.id) && p.role !== "pending");

  const isToday = day === workingDay();
  const nowTime = clock(now.toISOString());

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
              Allocation
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Who&apos;s on which machine, and since when
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div style={{ marginTop: 6 }}>
              <a
                href={`/allocation/wall?date=${day}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: BRAND.blue, textDecoration: "none" }}
              >
                Open the wall display ↗
              </a>
            </div>
          </div>
        </header>

        <Tabs current="allocation" tabs={caps.tabs} />

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
            Couldn&apos;t load the day. {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 12,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value || workingDay())}
            style={{
              border: `1px solid ${BRAND.line}`,
              background: BRAND.card,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          {!isToday && (
            <button onClick={() => setDay(workingDay())} style={btn}>
              Back to today
            </button>
          )}
          <span style={{ fontSize: 12, color: BRAND.sub }}>
            {day_.headcount} on the floor · {fmtHours(day_.hours)} allocated
            {day_.clocked > 0 ? ` · ${fmtHours(day_.clocked)} clocked` : ""}
            {day_.moves ? ` · ${day_.moves} ${day_.moves === 1 ? "move" : "moves"}` : ""}
            {day_.open ? ` · ${day_.open} still running` : ""}
          </span>
          {day_.backwards > 0 && (
            <span style={{ fontSize: 12, color: BRAND.red }}>
              {day_.backwards} finish before they start
            </span>
          )}
        </div>

        {/* Who isn't on anything. The question Adam is asking when he looks at
            the top of the board. */}
        <div
          style={{
            background: BRAND.card,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 16,
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 12, color: BRAND.sub, marginRight: 4 }}>
            Not on a machine ({spare.length}):
          </span>
          {spare.length === 0 ? (
            <span style={{ fontSize: 12, color: BRAND.sub }}>everyone is placed.</span>
          ) : (
            spare.map((p) => (
              <span
                key={p.id}
                style={{
                  fontSize: 12,
                  background: BRAND.bg,
                  border: `1px solid ${BRAND.line}`,
                  borderRadius: 20,
                  padding: "3px 10px",
                }}
              >
                {p.name}
              </span>
            ))
          )}
        </div>

        {machines.length === 0 && !loading && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            No machines in Decorflow yet — the board draws itself from that list.
          </p>
        )}

        {/* The CNCs first and on their own, then everything else: that's how
            the floor is laid out and how the day is read. */}
        {["CNC", "other"].map((band) => {
          const inBand = machines.filter((m) =>
            band === "CNC" ? m.type === "CNC" : m.type !== "CNC"
          );
          if (inBand.length === 0) return null;
          return (
            <div key={band} style={{ marginBottom: 18 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: BRAND.sub,
                  marginBottom: 6,
                }}
              >
                {band === "CNC" ? "Nesting" : "Finishing & packing"}
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 12,
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  alignItems: "start",
                }}
              >
                {inBand.map((machine) => {
                  const job = bookedJob(bookings, machine.id, day);
                  const mineOpen = allocations.filter(
                    (a) => a.machineId === machine.id && isOpen(a)
                  );
                  // The machine's own hours, not the sum of its people's —
                  // see mannedHours.
                  const machineHours = mannedHours(
                    allocations.filter((a) => a.machineId === machine.id),
                    now
                  );
                  const personHours = allocations
                    .filter((a) => a.machineId === machine.id && a.kind !== "break")
                    .reduce((s, a) => s + hoursOf(a, now), 0);
                  return (
                    <section
                      key={machine.id}
                      style={{
                        background: BRAND.card,
                        border: `1px solid ${BRAND.line}`,
                        borderTop: `3px solid ${machine.color}`,
                        borderRadius: 10,
                        padding: "10px 12px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{machine.name}</span>
                        <span style={{ fontSize: 11, color: BRAND.sub }}>{machine.type}</span>
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 12,
                            color: machineHours > machine.hpd ? BRAND.amber : BRAND.sub,
                          }}
                          title={`Manned ${fmtHours(machineHours)} of a ${machine.hpd}-hour day · ${fmtHours(personHours)} of work on it`}
                        >
                          {fmtHours(machineHours)} / {machine.hpd}h
                        </span>
                      </div>
                      {/* What the schedule already says is on this machine
                          today. A new slot starts from it. */}
                      <div style={{ fontSize: 11, color: BRAND.sub, marginTop: 1 }}>
                        {job ? `Booked: ${job}` : "Nothing booked today"}
                        {mineOpen.length > 0 ? ` · ${mineOpen.length} on it` : ""}
                      </div>

                      <div style={{ marginTop: 8 }}>
                        {Array.from({ length: SLOTS }, (_, slot) => {
                          const key = `${machine.id}:${slot}`;
                          const open = onSlot(allocations, machine.id, slot);
                          const done = closedOnSlot(allocations, machine.id, slot);
                          return (
                            <div
                              key={key}
                              style={{
                                borderTop: `1px solid ${BRAND.line}`,
                                paddingTop: 6,
                                marginTop: 6,
                              }}
                            >
                              {open ? (
                                <SlotRow
                                  allocation={open}
                                  name={nameOf(open.personId)}
                                  day={day}
                                  now={now}
                                  saving={saving}
                                  canAllocate={canAllocate}
                                  onSend={send}
                                />
                              ) : filling === key ? (
                                <FillSlot
                                  people={people}
                                  placed={placed}
                                  saving={saving}
                                  day={day}
                                  defaultJob={job}
                                  nowTime={nowTime}
                                  onCancel={() => setFilling(null)}
                                  onPick={async (personId, startAt, jobId, kind) => {
                                    const ok = await send({
                                      action: "open",
                                      date: day,
                                      personId,
                                      machineId: machine.id,
                                      slot,
                                      jobId,
                                      kind,
                                      startAt,
                                    });
                                    if (ok) setFilling(null);
                                  }}
                                />
                              ) : (
                                <button
                                  onClick={() => setFilling(key)}
                                  disabled={!canAllocate}
                                  style={{
                                    width: "100%",
                                    border: `1px dashed ${BRAND.line}`,
                                    background: "none",
                                    borderRadius: 6,
                                    padding: "5px 8px",
                                    fontSize: 12,
                                    color: BRAND.sub,
                                    cursor: canAllocate ? "pointer" : "default",
                                    fontFamily: "inherit",
                                    textAlign: "left",
                                    opacity: canAllocate ? 1 : 0.5,
                                  }}
                                >
                                  + Put someone on
                                </button>
                              )}

                              {/* What ran here earlier. Greyed, with its times
                                  and why it ended — the day's history, in
                                  place, rather than on another screen. */}
                              {done.map((a) => (
                                <div
                                  key={a.id}
                                  style={{
                                    fontSize: 11,
                                    color: BRAND.sub,
                                    marginTop: 3,
                                    display: "flex",
                                    gap: 6,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <span style={{ textDecoration: "line-through" }}>
                                    {nameOf(a.personId)}
                                  </span>
                                  <span>
                                    {clock(a.startAt)}–{clock(a.endAt)}
                                  </span>
                                  <span>{fmtHours(hoursOf(a, now))}</span>
                                  {a.closedReason === "moved" && (
                                    <span style={{ color: BRAND.amber }}>moved</span>
                                  )}
                                  {a.kind === "break" && <span>break</span>}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          );
        })}

        <DayRecords day={day} />
      </div>
    </main>
  );
}

/**
 * A person on a machine, right now.
 *
 * The times are typed rather than stamped, because that's how the day actually
 * gets recorded: Adam fills the board in when he gets a minute, not at the
 * moment somebody picks up a broom. They default to the clock when the slot is
 * filled, so the common case is one click.
 */
function SlotRow({ allocation, name, day, now, saving, canAllocate, onSend }) {
  const [start, setStart] = useState(clock(allocation.startAt));
  const [job, setJob] = useState(allocation.jobId || "");
  const [closing, setClosing] = useState(false);
  const [finish, setFinish] = useState(clock(new Date().toISOString()));

  useEffect(() => {
    setStart(clock(allocation.startAt));
    setJob(allocation.jobId || "");
  }, [allocation.startAt, allocation.jobId]);

  const field = {
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "2px 6px",
    fontSize: 12,
    fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: 13, fontWeight: 600, flex: "1 1 auto", minWidth: 90 }}>
        {name}
        {allocation.kind === "break" && (
          <span style={{ fontWeight: 400, color: BRAND.sub }}> · break</span>
        )}
      </span>
      <input
        value={start}
        onChange={(e) => setStart(e.target.value)}
        onBlur={() => {
          const at = atTime(day, start);
          if (at && at !== allocation.startAt) {
            onSend({ action: "update", id: allocation.id, startAt: at });
          }
        }}
        disabled={!canAllocate || saving}
        aria-label={`Start time for ${name}`}
        placeholder="07:30"
        style={{ ...field, width: 56 }}
      />
      <span style={{ fontSize: 11, color: BRAND.sub }}>
        {fmtHours(hoursOf(allocation, now))}
      </span>
      <input
        value={job}
        onChange={(e) => setJob(e.target.value)}
        onBlur={() => {
          if (job !== (allocation.jobId || "")) {
            onSend({ action: "update", id: allocation.id, jobId: job });
          }
        }}
        disabled={!canAllocate || saving}
        aria-label={`Job for ${name}`}
        placeholder="job"
        style={{ ...field, width: 72 }}
      />
      {closing ? (
        <>
          <input
            value={finish}
            onChange={(e) => setFinish(e.target.value)}
            aria-label={`Finish time for ${name}`}
            style={{ ...field, width: 56 }}
            autoFocus
          />
          {["finished", "shift-end"].map((reason) => (
            <button
              key={reason}
              onClick={async () => {
                const ok = await onSend({
                  action: "close",
                  id: allocation.id,
                  endAt: atTime(day, finish) || new Date().toISOString(),
                  closedReason: reason,
                });
                if (ok) setClosing(false);
              }}
              disabled={saving}
              style={{ ...miniBtn, color: BRAND.green, borderColor: BRAND.green }}
            >
              {reason === "finished" ? "Done" : "End of shift"}
            </button>
          ))}
          <button onClick={() => setClosing(false)} style={miniBtn}>
            Cancel
          </button>
        </>
      ) : (
        canAllocate && (
          <button onClick={() => setClosing(true)} style={{ ...miniBtn, color: BRAND.blue }}>
            Finish
          </button>
        )
      )}
    </div>
  );
}

/** Choosing who goes on an empty line. */
function FillSlot({ people, placed, saving, day, defaultJob, nowTime, onCancel, onPick }) {
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState(nowTime);
  const [job, setJob] = useState(defaultJob || "");
  const [kind, setKind] = useState("work");

  const field = {
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "3px 6px",
    fontSize: 12,
    fontFamily: "inherit",
  };

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <select
        autoFocus
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        style={{ ...field, flex: "1 1 120px", background: BRAND.card }}
      >
        <option value="">Who?</option>
        {/* Anyone already on a machine is offered too — picking them moves
            them, which is the honest reading of dropping a name on a slot. */}
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {placed.has(p.id) ? " (move)" : ""}
          </option>
        ))}
      </select>
      <input
        value={start}
        onChange={(e) => setStart(e.target.value)}
        aria-label="Start time"
        style={{ ...field, width: 56 }}
      />
      <input
        value={job}
        onChange={(e) => setJob(e.target.value)}
        aria-label="Job"
        placeholder="job"
        style={{ ...field, width: 72 }}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        style={{ ...field, background: BRAND.card }}
      >
        <option value="work">Work</option>
        <option value="break">Break</option>
      </select>
      <button
        onClick={() => onPick(personId, atTime(day, start), job, kind)}
        disabled={!personId || saving}
        style={{
          ...miniBtn,
          color: BRAND.green,
          borderColor: BRAND.green,
          opacity: !personId || saving ? 0.6 : 1,
        }}
      >
        {saving ? "…" : "On"}
      </button>
      <button onClick={onCancel} style={miniBtn}>
        Cancel
      </button>
    </div>
  );
}

/**
 * One line per day — what the spreadsheet was for.
 *
 * Loaded on demand rather than with the board: it's a look back, and a board
 * that reads a fortnight of allocations every minute is a board that spends
 * the read budget on history nobody is watching.
 */
function DayRecords({ day }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() => daysBefore(day, 13));
  const [to, setTo] = useState(day);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/allocation?from=${from}&to=${to}`, { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't read those days");
      const byDay = new Map();
      for (const a of json.allocations || []) {
        if (!byDay.has(a.date)) byDay.set(a.date, []);
        byDay.get(a.date).push(a);
      }
      const punchesByDay = new Map();
      for (const p of json.punches || []) {
        if (!punchesByDay.has(p.date)) punchesByDay.set(p.date, []);
        punchesByDay.get(p.date).push(p);
      }
      setRows(
        [...byDay.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, list]) => ({
            date,
            ...summarise(list, punchesByDay.get(date) || []),
          }))
      );
    } catch (e) {
      setErr(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const csv = () => {
    const head = ["Date", "Headcount", "Allocated hours", "Clocked hours", "Moves", "Still open"];
    const body = (rows || []).map((r) => [
      r.date,
      r.headcount,
      r.hours.toFixed(2),
      r.clocked.toFixed(2),
      r.moves,
      r.open,
    ]);
    const text = [head, ...body].map((line) => line.join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `allocation-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const th = {
    textAlign: "left",
    fontSize: 11,
    color: BRAND.sub,
    fontWeight: 500,
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };
  const td = {
    fontSize: 12,
    padding: "6px 10px",
    borderBottom: `1px solid ${BRAND.line}`,
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ marginTop: 24 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...btn, color: BRAND.blue, borderColor: BRAND.line }}
      >
        {open ? "Hide day records" : "Day records"}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              style={{ ...btn, cursor: "text" }}
            />
            <span style={{ fontSize: 12, color: BRAND.sub }}>to</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              style={{ ...btn, cursor: "text" }}
            />
            <button onClick={load} style={btn}>
              {busy ? "Reading…" : "Show"}
            </button>
            {rows && rows.length > 0 && (
              <button onClick={csv} style={{ ...btn, color: BRAND.blue }}>
                Export CSV
              </button>
            )}
          </div>

          {err && (
            <p style={{ fontSize: 12, color: BRAND.red, marginTop: 8 }}>{err}</p>
          )}

          {rows && rows.length === 0 && (
            <p style={{ fontSize: 12, color: BRAND.sub, marginTop: 8 }}>
              Nothing allocated in those days.
            </p>
          )}

          {rows && rows.length > 0 && (
            <div
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderRadius: 10,
                marginTop: 8,
                overflowX: "auto",
              }}
            >
              <table style={{ borderCollapse: "collapse", width: "100%" }}>
                <thead>
                  <tr>
                    <th style={th}>Day</th>
                    <th style={th}>On the floor</th>
                    <th style={th}>Allocated</th>
                    <th style={th}>Clocked</th>
                    <th style={th}>Moves</th>
                    <th style={th}>Unfinished</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.date}>
                      <td style={{ ...td, fontWeight: 600 }}>{r.date}</td>
                      <td style={td}>{r.headcount}</td>
                      <td style={td}>{fmtHours(r.hours)}</td>
                      <td style={{ ...td, color: BRAND.sub }}>
                        {r.clocked ? fmtHours(r.clocked) : "—"}
                      </td>
                      <td style={td}>{r.moves || "—"}</td>
                      {/* A day nobody closed off says so on its own line
                          rather than quietly reading as finished. */}
                      <td style={{ ...td, color: r.open ? BRAND.amber : BRAND.sub }}>
                        {r.open ? `${r.open} left running` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
