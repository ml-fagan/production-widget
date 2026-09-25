// Reading a day of allocations, shared by Adam's board and the wall display.
//
// Both screens show the same day and must agree, so the arithmetic lives in
// one place rather than being written twice and drifting once.

/**
 * Lines on a step before it has to be asked.
 *
 * Four, because four is what most of them take and six left every card with
 * two dashed rows of nothing. The card grows when Adam presses the plus: the
 * number is a position, not a quota.
 */
export const SLOTS = 4;

/** Today where the factory is, not where the browser thinks it is. */
export function workingDay(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * A day earlier, staying in the factory's calendar.
 *
 * Not `new Date(day).toISOString().slice(0, 10)`: that converts local midnight
 * to UTC, which in Adelaide is the previous afternoon, so every subtraction
 * loses a day. The wall asked for the day before yesterday and showed nothing.
 * Built from the local parts instead, at midday so daylight saving can't push
 * it over an edge either.
 */
export function daysBefore(date, n = 1) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/** "07:30" from an ISO stamp — what a time field shows and takes back. */
export function clock(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** "07:30" on a given day, back to an ISO stamp. */
export function atTime(date, hhmm) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !date) return null;
  const d = new Date(`${date}T00:00:00`);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.toISOString();
}

export function isOpen(a) {
  return !a.endAt;
}

/**
 * How long a segment ran, in hours. An open one is measured to now — a board
 * showing 0 against somebody who has been on the saw since seven is a board
 * nobody trusts.
 */
export function hoursOf(a, now = new Date()) {
  const from = Date.parse(a.startAt);
  const to = a.endAt ? Date.parse(a.endAt) : now.getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  return (to - from) / 3600000;
}

/**
 * How long a machine was manned, against how long its people worked.
 *
 * Two people on the nester for eight hours each is sixteen hours of work and
 * eight hours of machine. Decorflow's `hpd` is the machine's day, so the
 * comparison has to be the machine's: overlapping segments are merged rather
 * than added, or every busy machine reads as over its hours.
 */
export function mannedHours(allocations, now = new Date()) {
  const spans = allocations
    .filter((a) => a.kind !== "break")
    .map((a) => [Date.parse(a.startAt), a.endAt ? Date.parse(a.endAt) : now.getTime()])
    .filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && to > from)
    .sort((a, b) => a[0] - b[0]);

  let total = 0;
  let [from, to] = spans[0] ?? [0, 0];
  for (const [s, e] of spans.slice(1)) {
    if (s <= to) {
      to = Math.max(to, e);
      continue;
    }
    total += to - from;
    [from, to] = [s, e];
  }
  total += to - from;
  return total / 3600000;
}

export function fmtHours(h) {
  if (!h) return "—";
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${String(mins).padStart(2, "0")}m` : `${whole}h`;
}

/** The open segment on a slot, if anyone is on it. */
export function onSlot(allocations, stepId, slot) {
  return allocations.find(
    (a) => a.stepId === stepId && Number(a.slot) === slot && isOpen(a)
  );
}

/** Everything that ran on a slot today and has since been closed. */
export function closedOnSlot(allocations, stepId, slot) {
  return allocations
    .filter((a) => a.stepId === stepId && Number(a.slot) === slot && !isOpen(a))
    .sort((a, b) => String(a.startAt).localeCompare(String(b.startAt)));
}

/** The day as numbers — worked out here, never stored. */
export function summarise(allocations, punches = [], now = new Date()) {
  const people = new Set();
  const byPerson = new Map();
  let hours = 0;
  let moves = 0;
  let open = 0;
  let backwards = 0;

  for (const a of allocations) {
    people.add(a.personId);
    const h = hoursOf(a, now);
    if (a.kind !== "break") hours += h;
    byPerson.set(a.personId, (byPerson.get(a.personId) || 0) + h);
    if (a.closedReason === "moved") moves += 1;
    if (isOpen(a)) open += 1;
    if (a.endAt && Date.parse(a.endAt) <= Date.parse(a.startAt)) backwards += 1;
  }

  // What the clock says for the same day, for the gap rather than to correct
  // either side. The factory already punches in and out; this board is about
  // where people were, not what they're paid.
  const clocked = (() => {
    const byUid = new Map();
    const running = new Map();
    for (const p of [...punches].sort((a, b) => Number(a.ts) - Number(b.ts))) {
      if (p.type === "in") {
        running.set(p.uid, Number(p.ts));
        continue;
      }
      const from = running.get(p.uid);
      if (from === undefined) continue;
      byUid.set(p.uid, (byUid.get(p.uid) || 0) + (Number(p.ts) - from) / 3600000);
      running.delete(p.uid);
    }
    for (const [uid, from] of running) {
      byUid.set(uid, (byUid.get(uid) || 0) + Math.max(0, (now.getTime() - from) / 3600000));
    }
    return [...byUid.values()].reduce((s, h) => s + h, 0);
  })();

  return {
    headcount: people.size,
    hours,
    moves,
    open,
    backwards,
    clocked,
    byPerson,
  };
}
