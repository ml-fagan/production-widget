"use client";

import { useCallback, useEffect, useState } from "react";
import {
  workingDay,
  clock,
  isOpen,
  hoursOf,
  fmtHours,
  daysBefore,
} from "../../../lib/allocation.js";

// The wall display — where everyone is, read from across the room.
//
// A separate route rather than a narrow version of the board, because the
// thing that makes it different isn't the width: it has no identity behind it
// at all. It hangs on a screen in the factory that nobody logs into, so there
// are no controls, nothing to press by accident, and nothing on it that isn't
// already chalked on the board people walk past.
//
// Yesterday sits beside today so somebody can check their own hours while they
// still remember the day.

// The same palette as every other board. A screen on a wall isn't a different
// product, and a dark one next to seven light ones reads as a different system
// rather than as the same day shown larger.
const BRAND = {
  bg: "#f5f3ef",
  card: "#ffffff",
  ink: "#1c1b19",
  sub: "#6b6862",
  line: "#e5e1d8",
  green: "#408152",
  amber: "#a86b12",
  blue: "#004CFB",
};

// A screen on a wall is always visible, so this one polls regardless — but
// slowly, because nothing on it changes faster than somebody can walk between
// two steps.
const REFRESH_MS = 60 * 1000;

export default function WallDisplay() {
  const [day, setDay] = useState(workingDay());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  // A date in the link is for checking a particular day on a desk; the wall
  // itself asks for nothing and gets today.
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("date");
    if (asked && /^\d{4}-\d{2}-\d{2}$/.test(asked)) setDay(asked);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/allocation?from=${daysBefore(day)}&to=${day}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't read the day");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    }
  }, [day]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => {
      clearInterval(id);
      clearInterval(tick);
    };
  }, [load]);

  // A screen left up overnight should be showing the new day by morning,
  // without anybody touching it.
  useEffect(() => {
    const id = setInterval(() => {
      const today = workingDay();
      setDay((d) => (d === today ? d : today));
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const steps = (data?.steps ?? []).filter((s) => s.active);
  // Machines below the steps, in their own colour — the same split as the
  // board Adam fills in, so the two screens read the same way.
  const machines = (data?.machines ?? []).filter((m) => m.active);
  const tasks = (data?.tasks ?? []).filter((t) => t.date === day);
  const people = data?.people ?? [];
  const all = data?.allocations ?? [];
  const today = all.filter((a) => a.date === day);
  const before = all.filter((a) => a.date === daysBefore(day));
  const nameOf = (id) => people.find((p) => p.id === id)?.name || "—";

  return (
    <main
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        background: BRAND.bg,
        color: BRAND.ink,
        minHeight: "100vh",
        padding: 28,
        boxSizing: "border-box",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <h1 style={{ fontSize: 34, fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
          Where everyone is
        </h1>
        <span style={{ fontSize: 20, color: BRAND.sub }}>
          {new Date(`${day}T00:00:00`).toLocaleDateString("en-AU", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 20, color: BRAND.sub }}>
          {clock(now.toISOString())}
        </span>
      </header>

      {error && (
        <p style={{ fontSize: 18, color: BRAND.amber }}>
          Can&apos;t reach the board right now. Still trying.
        </p>
      )}

      {[
        { key: "steps", label: "", rows: steps, accent: BRAND.green },
        { key: "machines", label: "Machines", rows: machines, accent: BRAND.blue },
      ].map((band) =>
        band.rows.length === 0 ? null : (
          <div key={band.key} style={{ marginBottom: 18 }}>
            {band.label && (
              <div
                style={{
                  fontSize: 16,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: BRAND.sub,
                  marginBottom: 8,
                }}
              >
                {band.label}
              </div>
            )}
            <div
              style={{
                display: "grid",
                gap: 14,
                gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))",
                alignItems: "start",
              }}
            >
              {band.rows.map((step) => {

          // Everyone open on this step, however many lines it grew to.
          const here = today.filter((a) => a.stepId === step.id && isOpen(a));
          // The job on this place and how far it's got. The floor reads this
          // to know what they're on as much as who they're with.
          const jobs = tasks.filter((t) => t.placeId === step.id);
          return (
            <section
              key={step.id}
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderTop: `4px solid ${here.length ? band.accent : BRAND.line}`,
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 24, fontWeight: 600 }}>{step.name}</span>
                <span style={{ fontSize: 16, color: BRAND.sub, marginLeft: "auto" }}>
                  {here.length ? `${here.length} on` : "nobody on"}
                </span>
              </div>

              {jobs.map((task) => (
                <div
                  key={task.id}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 8,
                    marginTop: 6,
                    fontSize: 17,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{task.jobId || "no job number"}</span>
                  <span style={{ marginLeft: "auto", fontSize: 15, color: BRAND.green }}>
                    {[
                      task.packed && "packed",
                      task.photos && "photos",
                      task.finished && "finished",
                      task.completed && "done",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
              ))}

              <div style={{ marginTop: 10 }}>
                {here.length === 0 ? (
                  <div style={{ fontSize: 20, color: BRAND.sub }}>—</div>
                ) : (
                  here.map((a) => (
                    <div
                      key={a.id}
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 10,
                        padding: "5px 0",
                        borderTop: `1px solid ${BRAND.line}`,
                      }}
                    >
                      <span style={{ fontSize: 26, fontWeight: 600 }}>
                        {nameOf(a.personId)}
                      </span>
                      {a.kind === "break" && (
                        <span style={{ fontSize: 16, color: BRAND.amber }}>break</span>
                      )}
                      <span style={{ marginLeft: "auto", fontSize: 18, color: BRAND.sub }}>
                        {clock(a.startAt)}
                        {a.jobId ? ` · ${a.jobId}` : ""}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          );
              })}
            </div>
          </div>
        )
      )}

      {/* Yesterday, so somebody can check their own hours while they still
          remember the day. Closed segments only: what actually happened. */}
      {before.length > 0 && (
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 18, color: BRAND.sub, marginBottom: 8 }}>
            Yesterday — {new Date(`${daysBefore(day)}T00:00:00`).toLocaleDateString("en-AU", {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </div>
          <div
            style={{
              display: "grid",
              gap: 6,
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
            }}
          >
            {[...new Set(before.map((a) => a.personId))].map((personId) => {
              const mine = before.filter((a) => a.personId === personId);
              const hours = mine
                .filter((a) => a.kind !== "break")
                .reduce((s, a) => s + hoursOf(a, now), 0);
              const unfinished = mine.some(isOpen);
              return (
                <div
                  key={personId}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.line}`,
                    borderRadius: 10,
                    padding: "8px 12px",
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                  }}
                >
                  <span style={{ fontSize: 18 }}>{nameOf(personId)}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 18,
                      color: unfinished ? BRAND.amber : BRAND.green,
                    }}
                    title={unfinished ? "A slot was never finished off" : undefined}
                  >
                    {unfinished ? "not finished" : fmtHours(hours)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
