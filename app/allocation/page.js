"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import {
  workingDay,
  daysBefore,
  clock,
  atTime,
  isOpen,
  hoursOf,
  fmtHours,
  onStep,
  endedOnStep,
  mannedHours,
  summarise,
} from "../../lib/allocation.js";

// Allocation — who is on which step today.
//
// Adam's board. The roster stands on the left because that's what he reads
// first: who turned up. The steps run across, and a name moves from the roster
// onto a step and later onto another one.
//
// Both lists are his. The people aren't in Decorflow — warehouse staff mostly
// have no account, and giving every casual a login so they can be written on a
// board is the tail wagging the dog. The steps aren't Decorflow's machines
// either: he allocates around work the machine list doesn't describe.
//
// Moving somebody closes one segment and opens the next, so the day's history
// is the record rather than a feature built on top of it.

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

// A board somebody works from all morning, refreshed often enough to be worth
// looking at. Still paused while the tab is hidden.
const REFRESH_MS = 60 * 1000;
// Seven across, so the whole process is read without the eye travelling.
const COLUMNS = 7;

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
const miniBtn = { ...btn, padding: "2px 7px", fontSize: 11, borderRadius: 6 };
const field = {
  border: `1px solid ${BRAND.line}`,
  borderRadius: 6,
  padding: "2px 5px",
  fontSize: 11,
  fontFamily: "inherit",
  minWidth: 0,
};

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
  // Which step's card has its "add someone" open.
  const [adding, setAdding] = useState(null);
  const [editingLists, setEditingLists] = useState(false);
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

  const post = useCallback(
    async (path, payload) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first — an allocation has a name on it.");
        return false;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch(path, {
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

  const send = useCallback((payload) => post("/api/allocation", payload), [post]);
  const editList = useCallback((payload) => post("/api/allocation/list", payload), [post]);
  const editTask = useCallback((payload) => post("/api/allocation/task", payload), [post]);

  const steps = useMemo(() => (data?.steps ?? []).filter((s) => s.active), [data]);
  // Machines read differently from steps — a thing you stand at rather than a
  // job you're doing — so they get their own row and their own colour.
  const machines = useMemo(() => (data?.machines ?? []).filter((m) => m.active), [data]);
  const people = useMemo(() => (data?.people ?? []).filter((p) => p.active), [data]);
  const allNames = data?.people ?? [];
  const allocations = useMemo(
    () => (data?.allocations ?? []).filter((a) => a.date === day),
    [data, day]
  );
  // What each place is working on today, and what came of it.
  const tasks = useMemo(() => (data?.tasks ?? []).filter((t) => t.date === day), [data, day]);
  const nameOf = useCallback(
    (personId) => allNames.find((p) => p.id === personId)?.name || "—",
    [allNames]
  );

  const today = summarise(allocations, [], now);
  const placed = new Map();
  for (const a of allocations.filter(isOpen)) placed.set(a.personId, a.stepId);
  const stepName = (id) =>
    [...steps, ...machines].find((s) => s.id === id)?.name || "";

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
      <div style={{ maxWidth: 1800, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Allocation
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Who&apos;s on which step, and since when
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
              marginBottom: 12,
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
              marginBottom: 12,
            }}
          >
            Couldn&apos;t load the day. {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
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
            {today.headcount} on the floor · {fmtHours(today.hours)} allocated
            {today.moves ? ` · ${today.moves} ${today.moves === 1 ? "move" : "moves"}` : ""}
            {today.open ? ` · ${today.open} still running` : ""}
          </span>
          {today.backwards > 0 && (
            <span style={{ fontSize: 12, color: BRAND.red }}>
              {today.backwards} finish before they start
            </span>
          )}
          <button
            onClick={() => setEditingLists((v) => !v)}
            disabled={!canAllocate}
            style={{
              ...btn,
              marginLeft: "auto",
              color: BRAND.blue,
              opacity: canAllocate ? 1 : 0.5,
            }}
          >
            {editingLists ? "Done with lists" : "People, steps & machines"}
          </button>
        </div>

        {editingLists && canAllocate && (
          <ListEditor
            people={allNames}
            steps={data?.steps ?? []}
            machines={data?.machines ?? []}
            saving={saving}
            onEdit={editList}
          />
        )}

        {/* The roster on the left, the steps across. Two things read at once:
            who turned up, and where they went. */}
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <aside
            style={{
              flex: "0 0 190px",
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              padding: "10px 12px",
              position: "sticky",
              top: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
              People ({people.length})
            </div>
            <div style={{ fontSize: 11, color: BRAND.sub, marginBottom: 8 }}>
              {placed.size} on a step · {Math.max(0, people.length - placed.size)} spare
            </div>
            {people.length === 0 && (
              <p style={{ fontSize: 11, color: BRAND.sub }}>
                Nobody on the list yet — add them under People &amp; steps.
              </p>
            )}
            {people.map((p) => {
              const on = placed.get(p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    borderTop: `1px solid ${BRAND.line}`,
                    padding: "5px 0",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: on ? 400 : 600 }}>{p.name}</span>
                  {/* Where they are, or that they're going spare — the two
                      states worth knowing at a glance. */}
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 10,
                      color: on ? BRAND.green : BRAND.sub,
                      textAlign: "right",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 90,
                    }}
                    title={on ? stepName(on) : "not on a step"}
                  >
                    {on ? stepName(on) : "spare"}
                  </span>
                </div>
              );
            })}
          </aside>

          <div style={{ flex: 1, minWidth: 0 }}>
            {steps.length === 0 && machines.length === 0 && !loading && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                Nothing to allocate to yet. Add steps and machines under{" "}
                <strong>People, steps &amp; machines</strong> — both lists stay put from one day to
                the next.
              </p>
            )}

            {[
              { key: "steps", label: "Steps", rows: steps, accent: BRAND.green },
              // Machines sit under the steps and carry their own colour,
              // because "who's on the edgebander" and "who's packing" are two
              // different questions asked by two different people.
              { key: "machines", label: "Machines", rows: machines, accent: BRAND.blue },
            ].map((band) =>
              band.rows.length === 0 ? null : (
                <div key={band.key} style={{ marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 9,
                      letterSpacing: "0.07em",
                      textTransform: "uppercase",
                      color: BRAND.sub,
                      marginBottom: 5,
                    }}
                  >
                    {band.label}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
                      alignItems: "start",
                    }}
                  >
                    {band.rows.map((step) => {

                const mine = allocations.filter((a) => a.stepId === step.id);
                // The jobs on this place today, and what came of them.
                const here = tasks.filter((t) => t.placeId === step.id);
                const openHere = onStep(allocations, step.id);
                const endedHere = endedOnStep(allocations, step.id);
                const worked = mannedHours(mine, now);
                return (
                  <section
                    key={step.id}
                    style={{
                      background: BRAND.card,
                      border: `1px solid ${BRAND.line}`,
                      borderTop: `3px solid ${openHere.length ? band.accent : BRAND.line}`,
                      borderRadius: 10,
                      padding: "8px 9px",
                      minWidth: 0,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 12,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={step.name}
                      >
                        {step.name}
                      </span>
                      <span
                        style={{ marginLeft: "auto", fontSize: 10, color: BRAND.sub }}
                        title={`Manned ${fmtHours(worked)} today`}
                      >
                        {openHere.length || "—"}
                      </span>
                    </div>

                    {/* What this place is working on. The CRM and the ticks
                        belong to the job rather than to whoever is standing
                        there: three people pack it, it gets packed once. */}
                    {here.map((task) => (
                      <TaskBlock
                        key={task.id}
                        task={task}
                        saving={saving}
                        canAllocate={canAllocate}
                        onEdit={editTask}
                      />
                    ))}
                    {canAllocate && (
                      <button
                        onClick={() => editTask({ action: "add", date: day, placeId: step.id })}
                        disabled={saving}
                        title="Put a job against this place"
                        style={{
                          ...miniBtn,
                          width: "100%",
                          marginTop: 5,
                          color: BRAND.blue,
                          borderStyle: "dashed",
                        }}
                      >
                        + job
                      </button>
                    )}

                    <div style={{ marginTop: 4 }}>
                      {/* One cell with a list in it. Everyone on the step,
                          then everyone who was on it earlier, then a way to
                          add the next person — no numbered lines to keep
                          track of and no empty ones to look at. */}
                      {openHere.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            borderTop: `1px solid ${BRAND.line}`,
                            paddingTop: 4,
                            marginTop: 4,
                          }}
                        >
                          <PersonOnStep
                            allocation={a}
                            name={nameOf(a.personId)}
                            day={day}
                            now={now}
                            saving={saving}
                            canAllocate={canAllocate}
                            onSend={send}
                          />
                        </div>
                      ))}

                      {endedHere.map((a) => (
                        <div
                          key={a.id}
                          style={{
                            borderTop: `1px solid ${BRAND.line}`,
                            paddingTop: 4,
                            marginTop: 4,
                          }}
                        >
                          <PersonOnStep
                            allocation={a}
                            name={nameOf(a.personId)}
                            day={day}
                            now={now}
                            saving={saving}
                            canAllocate={canAllocate}
                            onSend={send}
                            ended
                          />
                        </div>
                      ))}

                      {adding === step.id ? (
                        <div style={{ borderTop: `1px solid ${BRAND.line}`, paddingTop: 4, marginTop: 4 }}>
                          <AddPerson
                            people={people}
                            placed={placed}
                            saving={saving}
                            day={day}
                            nowTime={nowTime}
                            onCancel={() => setAdding(null)}
                            onPick={async (personId, startAt, kind) => {
                              const ok = await send({
                                action: "open",
                                date: day,
                                personId,
                                stepId: step.id,
                                // One job on the place and the time is against
                                // it without anybody saying so. Several, and it
                                // waits to be told rather than guessing.
                                taskId: here.length === 1 ? here[0].id : "",
                                kind,
                                startAt,
                              });
                              if (ok) setAdding(null);
                            }}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => setAdding(step.id)}
                          disabled={!canAllocate}
                          title="Put someone on this step"
                          style={{
                            width: "100%",
                            border: `1px dashed ${BRAND.line}`,
                            background: "none",
                            borderRadius: 5,
                            padding: "3px 5px",
                            fontSize: 11,
                            color: BRAND.blue,
                            cursor: canAllocate ? "pointer" : "default",
                            fontFamily: "inherit",
                            marginTop: 5,
                            opacity: canAllocate ? 1 : 0.5,
                          }}
                        >
                          + add someone
                        </button>
                      )}
                    </div>
                  </section>
                );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        </div>

        <DayRecords day={day} />
      </div>
    </main>
  );
}

/**
 * The job a place is working on, and what came of it.
 *
 * The CRM is editable because it's usually known late — the job gets started
 * and named afterwards. The four ticks are facts about the work rather than
 * about the person doing it: three people pack a job and the job is packed
 * once, so they sit here rather than on anybody's stint.
 *
 * Each tick stamps who set it and when. Unticking clears the stamp rather than
 * recording an un-tick, because the question the floor asks is "is it packed",
 * not "how many times has somebody changed their mind".
 */
function TaskBlock({ task, saving, canAllocate, onEdit }) {
  const [job, setJob] = useState(task.jobId || "");

  useEffect(() => {
    setJob(task.jobId || "");
  }, [task.jobId]);

  const flags = [
    { key: "packed", label: "P", title: "Packed" },
    { key: "photos", label: "Ph", title: "Photos taken" },
    { key: "finished", label: "F", title: "Finished on the floor" },
    { key: "completed", label: "✓", title: "Completed — signed off" },
  ];

  return (
    <div
      style={{
        marginTop: 5,
        padding: "4px 5px",
        background: BRAND.bg,
        borderRadius: 6,
      }}
    >
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        <input
          value={job}
          onChange={(e) => setJob(e.target.value)}
          onBlur={() => {
            if (job.trim() !== (task.jobId || "")) {
              onEdit({ action: "update", id: task.id, jobId: job.trim() });
            }
          }}
          disabled={!canAllocate || saving}
          placeholder="CRM"
          aria-label="Job number for this task"
          style={{ ...field, flex: 1, minWidth: 0, fontWeight: 600 }}
        />
        {canAllocate && (
          <button
            onClick={() => onEdit({ action: "remove", id: task.id })}
            disabled={saving}
            title="Take this job off the place"
            style={{ ...miniBtn, padding: "1px 5px", color: BRAND.sub }}
          >
            ✕
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
        {flags.map((f) => {
          const on = Boolean(task[f.key]);
          const by = task[`${f.key}By`];
          return (
            <button
              key={f.key}
              onClick={() => onEdit({ action: "update", id: task.id, flags: { [f.key]: !on } })}
              disabled={!canAllocate || saving}
              title={
                on && by ? `${f.title} — ${String(by).split("@")[0]}` : f.title
              }
              style={{
                flex: 1,
                border: `1px solid ${on ? BRAND.green : BRAND.line}`,
                background: on ? "#e6efe7" : BRAND.card,
                color: on ? BRAND.green : BRAND.sub,
                fontWeight: on ? 600 : 400,
                borderRadius: 5,
                padding: "1px 0",
                fontSize: 10,
                cursor: canAllocate ? "pointer" : "default",
                fontFamily: "inherit",
                minWidth: 0,
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A person on a step — on it now, or ended off it earlier.
 *
 * The same row either way, because it's the same fact at two moments and Adam
 * corrects both the same way: the times are typed, beside the name. He fills
 * the board in when he gets a minute, not when somebody picks up a broom, so
 * what's written is always a recollection and always worth being able to fix.
 *
 * An ended row keeps its finish time editable for exactly that reason. Ending
 * someone is one click; getting the minute right can wait until he's sitting
 * down.
 */
function PersonOnStep({ allocation, name, day, now, saving, canAllocate, onSend, ended = false }) {
  const [start, setStart] = useState(clock(allocation.startAt));
  const [finish, setFinish] = useState(clock(allocation.endAt));

  useEffect(() => {
    setStart(clock(allocation.startAt));
    setFinish(clock(allocation.endAt));
  }, [allocation.startAt, allocation.endAt]);

  const push = (patch) => onSend({ action: "update", id: allocation.id, ...patch });

  const time = (value, setValue, onCommit, label) => (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onCommit}
      disabled={!canAllocate || saving}
      aria-label={`${label} for ${name}`}
      placeholder="--:--"
      style={{ ...field, width: 44, color: ended ? BRAND.sub : BRAND.ink }}
    />
  );

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: ended ? 400 : 600,
          color: ended ? BRAND.sub : BRAND.ink,
          flex: "1 1 60px",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={name}
      >
        {name}
        {allocation.kind === "break" && (
          <span style={{ fontWeight: 400, color: BRAND.sub }}> · break</span>
        )}
      </span>

      {time(start, setStart, () => {
        const at = atTime(day, start);
        if (at && at !== allocation.startAt) push({ startAt: at });
      }, "Start time")}

      {ended ? (
        <>
          <span style={{ fontSize: 10, color: BRAND.sub }}>–</span>
          {time(finish, setFinish, () => {
            const at = atTime(day, finish);
            if (at && at !== allocation.endAt) push({ endAt: at });
          }, "Finish time")}
        </>
      ) : (
        canAllocate && (
          <button
            onClick={() =>
              onSend({
                action: "close",
                id: allocation.id,
                endAt: new Date().toISOString(),
                closedReason: "finished",
              })
            }
            disabled={saving}
            title="End this one — the times stay editable afterwards"
            style={{ ...miniBtn, color: BRAND.blue, padding: "1px 6px" }}
          >
            end
          </button>
        )
      )}

      <span style={{ fontSize: 10, color: BRAND.sub, marginLeft: "auto" }}>
        {fmtHours(hoursOf(allocation, now))}
        {allocation.closedReason === "moved" && (
          <span style={{ color: BRAND.amber }}> moved</span>
        )}
      </span>
    </div>
  );
}

/** Choosing who goes on a step. */
function AddPerson({ people, placed, saving, day, nowTime, onCancel, onPick }) {
  const [personId, setPersonId] = useState("");
  const [start, setStart] = useState(nowTime);
  const [kind, setKind] = useState("work");

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
      <select
        autoFocus
        value={personId}
        onChange={(e) => setPersonId(e.target.value)}
        style={{ ...field, flex: "1 1 100%", background: BRAND.card }}
      >
        <option value="">Who?</option>
        {/* Somebody already on a step is offered too — picking them moves
            them, which is the honest reading of putting a name somewhere
            else. */}
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
        style={{ ...field, width: 44 }}
      />
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value)}
        style={{ ...field, width: 58, background: BRAND.card }}
      >
        <option value="work">work</option>
        <option value="break">break</option>
      </select>
      <button
        onClick={() => onPick(personId, atTime(day, start), kind)}
        disabled={!personId || saving}
        style={{
          ...miniBtn,
          color: BRAND.green,
          borderColor: BRAND.green,
          opacity: !personId || saving ? 0.6 : 1,
        }}
      >
        on
      </button>
      <button onClick={onCancel} style={miniBtn}>
        ✕
      </button>
    </div>
  );
}

/**
 * Adam's two lists.
 *
 * Kept the way Mitch keeps the material list: type a name, it's there
 * tomorrow, take it away when it stops being true. Removing is a flag rather
 * than a delete — a step he stops using is still the step yesterday's
 * allocations were written against.
 */
function ListEditor({ people, steps, machines, saving, onEdit }) {
  const [newPerson, setNewPerson] = useState("");
  const [newStep, setNewStep] = useState("");
  const [newMachine, setNewMachine] = useState("");

  const heading = { people: "People", steps: "Steps", machines: "Machines" };

  const column = (kind, rows, value, setValue, placeholder) => (
    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{heading[kind]}</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key !== "Enter" || !value.trim()) return;
            const ok = await onEdit({ kind, action: "add", name: value.trim() });
            if (ok) setValue("");
          }}
          placeholder={placeholder}
          style={{
            flex: 1,
            border: `1px solid ${BRAND.line}`,
            borderRadius: 6,
            padding: "4px 8px",
            fontSize: 12,
            fontFamily: "inherit",
            minWidth: 0,
          }}
        />
        <button
          onClick={async () => {
            if (!value.trim()) return;
            const ok = await onEdit({ kind, action: "add", name: value.trim() });
            if (ok) setValue("");
          }}
          disabled={saving || !value.trim()}
          style={{ ...miniBtn, color: BRAND.green, borderColor: BRAND.green }}
        >
          Add
        </button>
      </div>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            borderTop: `1px solid ${BRAND.line}`,
            padding: "4px 0",
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: row.active ? BRAND.ink : BRAND.sub,
              textDecoration: row.active ? "none" : "line-through",
              flex: 1,
              minWidth: 0,
            }}
          >
            {row.name}
          </span>
          <button
            onClick={() => onEdit({ kind, action: row.active ? "remove" : "restore", id: row.id })}
            disabled={saving}
            style={{ ...miniBtn, color: row.active ? BRAND.sub : BRAND.green }}
          >
            {row.active ? "Remove" : "Put back"}
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.line}`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
        display: "flex",
        gap: 20,
        flexWrap: "wrap",
      }}
    >
      {column("people", people, newPerson, setNewPerson, "Name")}
      {column("steps", steps, newStep, setNewStep, "Step, e.g. Packing")}
      {column("machines", machines, newMachine, setNewMachine, "Machine, e.g. Edgebander")}
      <p style={{ fontSize: 11, color: BRAND.sub, flexBasis: "100%", margin: 0 }}>
        All three lists stay put from one day to the next. Removing takes something off the board
        without touching the days it was already written on. A step is a job to be doing; a machine
        is a thing to stand at, and they read as two rows on the board.
      </p>
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
      setRows(
        [...byDay.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([date, list]) => ({ date, ...summarise(list) }))
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
    const head = ["Date", "Headcount", "Allocated hours", "Moves", "Still open"];
    const body = (rows || []).map((r) => [r.date, r.headcount, r.hours.toFixed(2), r.moves, r.open]);
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
    <div style={{ marginTop: 20 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ ...btn, color: BRAND.blue }}>
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

          {err && <p style={{ fontSize: 12, color: BRAND.red, marginTop: 8 }}>{err}</p>}

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
                      <td style={td}>{r.moves || "—"}</td>
                      {/* A day nobody closed off says so rather than quietly
                          reading as finished. */}
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
