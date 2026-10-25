"use client";

/**
 * When a board is allowed to read again.
 *
 * Every board here polls on a timer and refreshes when the window is focused.
 * The timer was never the expensive half. The focus listener had no throttle at
 * all, so alt-tabbing back to the browser cost a full reload of every
 * collection that board reads — and somebody moving between Outlook, a drawing
 * and the board a few times a minute paid for all of it.
 *
 * That is the shape of the curve on 11 October: a steady climb, nearly all
 * reads, almost no writes, with nobody doing anything unusual. There is a
 * twenty-second cache in the handover app that collapses several browsers
 * polling at once, but a person's tab-switching rhythm walks straight past a
 * twenty-second window.
 *
 * So a refresh on focus now only happens if the board hasn't read recently.
 * Two minutes, against a fifteen-minute timer: still far fresher than the poll
 * it sits beside, and it turns a burst of tab switches into one read.
 */

/** Long enough to collapse a burst of tab switches, short enough to go unnoticed. */
export const FOCUS_MIN_GAP_MS = 2 * 60 * 1000;

/**
 * A tab nobody is looking at doesn't need reading for.
 *
 * Every board refreshes when it's focused, so a hidden one loses nothing by
 * sitting still — and a browser left open over a weekend stops costing
 * anything.
 */
export function pollWhenVisible(run, everyMs) {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    run();
  }, everyMs);
}

/**
 * Wire up "refresh when they come back", throttled.
 *
 * Returns the teardown, so a board can hand it straight back from its effect.
 * `run` is called at most once per `minGapMs` however many focus and
 * visibility events arrive — and the clock starts now, because the board has
 * just loaded.
 *
 * Both events are listened for because neither covers the case alone:
 * `focus` misses coming back to an already-focused window from another tab,
 * and `visibilitychange` misses coming back from another application.
 */
export function refreshOnReturn(run, minGapMs = FOCUS_MIN_GAP_MS) {
  let last = Date.now();
  const onReturn = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    const now = Date.now();
    if (now - last < minGapMs) return;
    last = now;
    run();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  return () => {
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}

/**
 * The timer and the focus listener together, since every board wants both.
 *
 * `touch()` lets the board tell the throttle it has just read for some other
 * reason — a manual Refresh, or a write that reloaded the list — so coming
 * back to the window a moment later doesn't read again.
 */
export function refreshLoop(run, everyMs, minGapMs = FOCUS_MIN_GAP_MS) {
  let last = Date.now();
  const marked = () => {
    last = Date.now();
    run();
  };
  const timer = pollWhenVisible(marked, everyMs);
  const onReturn = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (Date.now() - last < minGapMs) return;
    marked();
  };
  window.addEventListener("focus", onReturn);
  document.addEventListener("visibilitychange", onReturn);
  return () => {
    clearInterval(timer);
    window.removeEventListener("focus", onReturn);
    document.removeEventListener("visibilitychange", onReturn);
  };
}
