"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import PickOne from "../PickOne.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { PROCESS_COLUMNS, CELL_COLOURS, cellState } from "../../lib/board.js";
import {
  groupByProduct,
  dimension,
  splitMaterialName,
  placementKeyOf,
} from "../../lib/materialGroups.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import {
  RACKS,
  AREAS,
  PRODUCTION_BLOCKS,
  bayCode,
  zoneCode,
  allLocations,
  locationCode,
  describeLocation,
  spreadFrom,
  bayLoad,
  bayState,
  capacityOf,
  sectionOf,
  DEFAULT_CAPACITIES,
  BAY_COLOURS,
} from "../../lib/factoryLayout.js";

// Stock — everything about where material physically is, outside the
// ordered/delivered checklist on Material orders: what's on hand in the
// factory (offcuts Duncan logs as leftover, or Alice's own adds/uses),
// what's been pre-ordered ahead of a handover existing, and what stage each
// job's own material is at on Duncan's board.
//
// Append-only stock ledger: every add or use is its own entry, and the
// balance for a material is just the sum of its entries. Nothing here edits
// or deletes a past entry, so the history stays honest — using stock is a
// new negative entry, not erasing the positive one that brought it in.

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

// A tab nobody is looking at doesn't need reading for. Every board refreshes
// when it's focused, so a hidden one loses nothing by sitting still — and a
// browser left open over a weekend stops costing anything.
function pollWhenVisible(run, everyMs) {
  return setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    run();
  }, everyMs);
}

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

function signature(e) {
  return [
    String(e.name || "").trim().toLowerCase(),
    // Read as numbers, so "9mm" and "9" are one shelf rather than two —
    // see `dimension`.
    String(dimension(e.length)),
    String(dimension(e.width)),
    String(dimension(e.thickness)),
  ].join("|");
}

function balancesFrom(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = signature(e);
    if (!map.has(key)) {
      map.set(key, { name: e.name, length: e.length, width: e.width, thickness: e.thickness, total: 0, entries: [] });
    }
    const bucket = map.get(key);
    bucket.total += Number(e.quantity) || 0;
    bucket.entries.push(e);
  }
  for (const bucket of map.values()) {
    bucket.entries.sort((a, b) => (a.loggedAt < b.loggedAt ? 1 : -1));
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function effectiveState(m) {
  return m.state || "to_order";
}

function size(m) {
  if (!m.length || !m.width) return "—";
  return `${m.length} × ${m.width}${m.thickness ? ` × ${m.thickness}` : ""}`;
}

// Where a job actually is on Duncan's board right now: whichever assigned
// process is under way, or else the furthest one finished, or else the
// first not yet started.
function currentStage(handover) {
  const relevant = PROCESS_COLUMNS.filter((c) => cellState(handover, c) !== "none");
  if (relevant.length === 0) return null;
  const doing = relevant.find((c) => cellState(handover, c) === "doing");
  if (doing) return { stage: doing, state: "doing" };
  const done = relevant.filter((c) => cellState(handover, c) === "done");
  if (done.length === relevant.length) return { stage: "Packed", state: "done" };
  if (done.length) return { stage: done[done.length - 1], state: "done" };
  return { stage: relevant[0], state: "todo" };
}

function StageBadge({ handover }) {
  const stage = currentStage(handover);
  if (!stage) return <span style={{ color: BRAND.sub, fontSize: 12 }}>—</span>;
  return (
    <span
      style={{
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 4,
        background: stage.stage === "Packed" ? "#cfe3d4" : CELL_COLOURS[stage.state].bg,
        border: `1px solid ${BRAND.line}`,
      }}
    >
      {stage.stage}
    </span>
  );
}

function materialSignature(m) {
  return [String(m.name || "").trim().toLowerCase(), m.length, m.width, m.thickness].join("|");
}

// Same materials, regrouped by what they are rather than which job they're
// for — so Alice can see every job waiting on "Blackbutt NTV" in one place.
function buildMaterialGroups(jobs) {
  const map = new Map();
  for (const h of jobs) {
    for (const m of h.materials || []) {
      const key = materialSignature(m);
      if (!map.has(key)) {
        map.set(key, { name: m.name, length: m.length, width: m.width, thickness: m.thickness, rows: [] });
      }
      map.get(key).rows.push({ ...m, jobId: h.jobId, project: h.project || h.client, handover: h });
    }
  }
  return [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

// Only "used" entries (negative) assigned to this exact job — a leftover
// logged *from* this job is the opposite direction, not "fetch this".
function stockForJob(stockEntries, jobId) {
  const used = stockEntries.filter((e) => e.jobId === jobId && Number(e.quantity) < 0);
  const map = new Map();
  for (const e of used) {
    const key = [e.name, e.length, e.width, e.thickness].join("|");
    const sz = [e.length, e.width, e.thickness].filter(Boolean).join("×");
    const bucket = map.get(key) || { name: e.name, size: sz, qty: 0 };
    bucket.qty += Math.abs(Number(e.quantity) || 0);
    map.set(key, bucket);
  }
  return [...map.values()];
}

const SECTIONS = [
  { key: "hand", label: "On hand" },
  { key: "tracking", label: "Tracking" },
  // The same register, arranged as the building rather than as a list. "Have
  // we got any Blackbutt" is the On hand question; "where is it" is this one,
  // and they were the same page answering only the first.
  { key: "layout", label: "Factory layout" },
];

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
// Smaller again, for the rows inside a finish box — several fit on a line
// there, and the full-size button reads as the box's own action.
const miniBtn = { ...btn, padding: "2px 8px", fontSize: 11, borderRadius: 6 };

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
  padding: "5px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  fontSize: 12,
  whiteSpace: "nowrap",
};

export default function MaterialStockPage() {
  const [entries, setEntries] = useState([]);
  // What the handover app says is already spoken for — see loadAvailable.
  const [available, setAvailable] = useState([]);
  const [options, setOptions] = useState({ finishes: [], substrates: [] });
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [query, setQuery] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [trackBy, setTrackBy] = useState("project");
  const [section, setSection] = useState("hand");
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  /**
   * Keeping the register — adding, using, clearing — against counting what's
   * on the rack.
   *
   * They're different jobs done by different people. Alice decides what we
   * hold and what a job takes; the warehouse walks round and says what's
   * actually there. The second is the only thing the floor gets here, so the
   * rest doesn't render for them: a row of buttons that all refuse is worse
   * than no buttons.
   */
  const canKeep = caps.materials;
  const canCount = caps.materials || caps.receiving;
  const [showAdd, setShowAdd] = useState(false);
  // What "Enter what's on the rack" puts into the Add form: the material the
  // register is short of, so squaring it is a quantity rather than six fields
  // retyped from a red line two inches above.
  const [addInitial, setAddInitial] = useState(null);
  const [useRow, setUseRow] = useState(null); // signature of the row being drawn down
  const [expanded, setExpanded] = useState({});
  const [noteEdit, setNoteEdit] = useState(null); // id of the entry whose note is open
  const [noteDraft, setNoteDraft] = useState("");
  const [countRow, setCountRow] = useState(null); // signature of the row being counted
  const [countDraft, setCountDraft] = useState("");
  const [counted, setCounted] = useState(null); // what the last count came to
  const [placements, setPlacements] = useState([]); // where each material's sheets sit
  const [capacities, setCapacities] = useState(DEFAULT_CAPACITIES); // sheets per section
  const [placeRow, setPlaceRow] = useState(null); // signature of the row being put on a bay
  const [bay, setBay] = useState(null); // the location being looked at on the plan
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState({});

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/material-stock", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load material stock");
      setEntries(json.entries || []);
      setPlacements(json.placements || []);
      // Anything not set yet keeps the built-in figure, so a fresh install
      // draws a sensible plan rather than a warehouse that holds nothing.
      setCapacities({ ...DEFAULT_CAPACITIES, ...(json.capacities || {}) });
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  // The finish and substrate lists come from the handover app so both screens
  // offer the same words. Empty until they load, which leaves the pickers with
  // only "Other" — free text, which is where this started.
  const loadOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/materials/options", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setOptions({ finishes: json.finishes || [], substrates: json.substrates || [] });
    } catch {
      // Leaves the pickers on free text rather than blocking an add.
    }
  }, []);

  // Which sheets are already promised to a job. Worked out by the handover
  // app from its own open handovers, not here: Mitch sees the same numbers
  // beside his picking list, and two screens computing it separately is two
  // screens that can disagree about whether a sheet is free.
  const loadAvailable = useCallback(async () => {
    try {
      const res = await fetch("/api/material-stock/available", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setAvailable(json.materials || []);
    } catch {
      // Balances still show; nothing reads as reserved until the next refresh.
    }
  }, []);

  // For the job picker on "Use" and for the Tracking section — both need the
  // live job list.
  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) return;
      setJobs([...(json.awaiting || []), ...(json.scheduled || [])]);
    } catch {
      // Whatever needed it just comes up empty until the next refresh.
    }
  }, []);

  useEffect(() => {
    load();
    loadAvailable();
    loadOptions();
    loadJobs();
    const id = pollWhenVisible(() => {
      load();
      loadAvailable();
      loadJobs();
      }, REFRESH_MS);
    const onFocus = () => {
      load();
      loadAvailable();
      loadJobs();
      };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadAvailable, loadOptions, loadJobs]);

  const submit = useCallback(
    async (entry) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return false;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/material-stock/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ ...entry, source: "manual" }], idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Save failed");
        setEntries((prev) => [...(json.entries || []), ...prev]);
        return true;
      } catch (e) {
        setActionError(String(e.message || e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /**
   * How many sheets a section holds.
   *
   * Every one of these started as a guess in the code. The person loading a
   * rack knows what it takes, and until they can say so the plan's colours are
   * an opinion dressed as a fact.
   */
  const saveCapacities = useCallback(async (next) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-stock/capacities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capacities: next, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't save that");
      setCapacities({ ...DEFAULT_CAPACITIES, ...(json.capacities || {}) });
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Where a material's sheets sit, as a whole list.
   *
   * One call for the whole arrangement: spreading an overflow is a single
   * decision — this much here, that much there — and writing it a bay at a
   * time would leave the register readable in a state nobody intended.
   */
  const savePlacements = useCallback(async (b, list) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-stock/placements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: b.name,
          length: b.length,
          width: b.width,
          thickness: b.thickness,
          placements: list,
          idToken,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't save where that goes");
      setPlacements((prev) => {
        const without = prev.filter((p) => p.id !== json.placement.id);
        return [...without, json.placement];
      });
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * A stocktake on one size: how many are actually on the rack.
   *
   * The correction itself is the handover app's to work out — it recounts the
   * ledger and posts the difference, so the number that gets corrected is the
   * one in the register at that moment rather than whatever this page last
   * loaded. Two people counting two racks a minute apart shouldn't be able to
   * create the discrepancy they went out to close.
   */
  const countStock = useCallback(async (b, counted) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-stock/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: b.name,
          length: b.length,
          width: b.width,
          thickness: b.thickness,
          counted,
          idToken,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't record that count");
      if (json.entry) setEntries((prev) => [json.entry, ...prev]);
      // Counted and it was already right: nothing is written, so say so rather
      // than leaving the screen looking as though nothing happened.
      setCounted(
        json.difference === 0
          ? `${b.name} counted at ${json.counted} — the register already said so.`
          : `${b.name}: ${json.difference > 0 ? "+" : ""}${json.difference} — register was ${json.onHand}, rack holds ${json.counted}.`
      );
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Rewrites the note on one entry.
   *
   * Notes were written once and fixed for good, which meant the only ways to
   * correct "check the colour before use" were to clear the material and
   * re-enter it, or to log a movement that never happened to carry the new
   * wording. Neither is a thing a register should ask for.
   *
   * Only the note: the quantity and who logged it are the ledger, and the
   * ledger stays append-only. The edit stamps its own name, so the card can
   * say who changed it without taking the original line off anybody.
   */
  const saveNote = useCallback(async (id, note) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-stock/note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, note, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't save that note");
      setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...json.entry } : e)));
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Removes a material from the register entirely — every entry behind its
   * balance.
   *
   * For something typed wrong. Using stock up is a negative entry, which keeps
   * the history; an entry that was never true has no history worth keeping, and
   * offsetting it would leave two wrong numbers instead of none. Confirmed
   * first, because it can't be undone.
   */
  const clearMaterial = useCallback(async (balance) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const ids = (balance.entries || []).map((e) => e.id).filter(Boolean);
    if (ids.length === 0) return;
    const label = [balance.name, balance.length && balance.width
      ? `${balance.length} × ${balance.width}`
      : ""].filter(Boolean).join(" ");
    if (
      !window.confirm(
        `Clear ${label} from the register? This deletes ${ids.length} ` +
          `${ids.length === 1 ? "entry" : "entries"} and can't be undone.`
      )
    ) {
      return;
    }

    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/material-stock/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Couldn't clear that material");
      setEntries((prev) => prev.filter((e) => !ids.includes(e.id)));
    } catch (e) {
      setActionError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Accepting that a negative balance is never going to be filled.
   *
   * Sheets were drawn for a job that the register never held — because they
   * went on a rack card under another name, or were never entered at all. If
   * nobody is going to enter them now, the honest close is not to hide the
   * line but to post the correction: a balancing entry, with a note saying
   * what it is, which brings the material to zero and leaves the whole story
   * in its history. A ledger squares up; it doesn't forget.
   */
  const writeOff = useCallback(
    async (b) => {
      const short = -Number(b.total) || 0;
      if (short <= 0) return;
      if (
        !window.confirm(
          `Write off ${short} × ${b.name}?\n\nThis doesn't put anything on the racks — it records that ${short} were drawn for jobs that the register never held, and brings it to zero.`
        )
      ) {
        return;
      }
      await submit({
        name: b.name,
        length: b.length,
        width: b.width,
        thickness: b.thickness,
        quantity: short,
        note: "Written off — drawn for jobs without ever being entered here",
      });
    },
    // submit is defined above and stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /**
   * The job's own picking-list line for this material, if it has one.
   *
   * Drawing stock and ticking "In stock" on a handover are two people moving
   * the same sheets, and they used to know nothing about each other: she'd
   * draw them here, the schedule would draw them again when Duncan dated the
   * job, and the register would be short twice over. So a draw looks for the
   * line first and goes through it — confirming it and stamping it drawn, so
   * the schedule leaves it alone.
   *
   * Matched on the name and the size as the register stores them. A line
   * that's already been drawn doesn't count: those sheets are gone.
   */
  const lineForDraw = useCallback(
    (jobId, b) => {
      const job = jobs.find((h) => h.jobId === jobId);
      if (!job) return null;
      const size = (x) =>
        [dimension(x.length), dimension(x.width), dimension(x.thickness)].join("|");
      return (
        (job.materials || []).find(
          (m) =>
            m.fromStock &&
            !m.stockDrawnAt &&
            String(m.name || "").trim().toLowerCase() ===
              String(b.name || "").trim().toLowerCase() &&
            size(m) === size(b)
        ) || null
      );
    },
    [jobs]
  );

  /** Drawing through the line, so it can only happen once. */
  const drawAgainstLine = useCallback(async (jobId, lineId, quantity, note) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/draw-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, lineId, quantity, note, idToken }),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(
          json.error === "already_drawn"
            ? "That line has already been drawn — the sheets are off the register."
            : json.error || "Save failed"
        );
      }
      // The ledger, the job and the claim all moved at once.
      load();
      loadAvailable();
      loadJobs();
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [load, loadAvailable, loadJobs]);

  const balances = useMemo(() => balancesFrom(entries), [entries]);
  const q = query.trim().toLowerCase();
  const matchingBalances = q ? balances.filter((b) => (b.name || "").toLowerCase().includes(q)) : balances;
  const onHand = matchingBalances.filter((b) => b.total > 0);
  /**
   * Materials the register says we have less than none of.
   *
   * It happens when a job draws stock that was never entered — or was entered
   * under a different name, which is the same thing to a ledger: "Blackbutt
   * NTV" drawn against a card that says "Blackbutt". The balance goes negative
   * and, because the boxes only show what's on hand, the material disappears
   * from the page entirely.
   *
   * That is the worst thing it could do. Duncan logs five sheets back off a
   * job, they land in a balance of minus twenty-eight, and nobody can see
   * either number. So they're listed, plainly, with what's been logged against
   * them — a register that's wrong is worth knowing about.
   */
  const overdrawn = matchingBalances.filter((b) => b.total < 0);
  const productGroups = useMemo(
    () => groupByProduct(onHand, available),
    // onHand is rebuilt each render from balances and the filter, so depend on
    // what actually decides it rather than on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, q, available]
  );

  /**
   * The same register, laid out as the building.
   *
   * Deliberately not filtered by the box above it: that box belongs to the
   * On hand list, and a plan quietly showing only the material somebody
   * happened to search for an hour ago would be a map that lies. Every row
   * with something on it, every time.
   */
  const placedRows = useMemo(
    () =>
      groupByProduct(
        balances.filter((b) => b.total > 0),
        available
      ).flatMap((g) =>
        g.rows.map((r) => ({ ...r, finish: g.finish, product: g.thickness }))
      ),
    [balances, available]
  );
  /**
   * Where each material's sheets sit.
   *
   * Explicit placements win. A material nobody has spread still reads its old
   * coded location and counts as all of it on that bay, so everything put on
   * the map before this existed stays where it was put.
   */
  const placementIndex = useMemo(() => {
    const map = new Map();
    for (const p of placements) map.set(String(p.id), p.placements || []);
    return map;
  }, [placements]);

  const placedFor = useCallback(
    (row) => {
      const key = placementKeyOf(row);
      const explicit = placementIndex.get(key);
      if (explicit && explicit.length) {
        return explicit.map((p) => ({
          bay: p.bay,
          // Null means "all of it" — the ordinary one-rack case, which can't
          // go stale because it carries no number.
          quantity: p.quantity == null ? row.total : Number(p.quantity) || 0,
        }));
      }
      if (explicit) return []; // deliberately taken off the map
      const legacy = locationCode(row.location);
      return legacy ? [{ bay: legacy, quantity: row.total }] : [];
    },
    [placementIndex]
  );

  /** bay → the materials on it, each with how many of them are there. */
  const byLocation = useMemo(() => {
    const map = new Map();
    for (const row of placedRows) {
      for (const p of placedFor(row)) {
        if (!map.has(p.bay)) map.set(p.bay, []);
        map.get(p.bay).push({ ...row, here: p.quantity });
      }
    }
    return map;
  }, [placedRows, placedFor]);

  // Sheets per bay, for the plan's colour and for showing where there's room
  // while somebody is choosing one.
  const bayLoads = useMemo(
    () => new Map([...byLocation].map(([code, rows]) => [code, bayLoad(rows)])),
    [byLocation]
  );
  // Material on a rack that nobody has told the map about. Worth showing,
  // because it's the list that makes the map finish itself.
  const unplaced = useMemo(
    () => placedRows.filter((r) => placedFor(r).length === 0),
    [placedRows, placedFor]
  );
  const bayRows = bay ? byLocation.get(bay) ?? [] : [];

  // Tracking follows work in progress, so a job drops off it the moment
  // Duncan marks it complete — and disappears outright if it's deleted, since
  // the record it was drawn from is gone.
  const trackable = jobs.filter((h) => !h.schedule?.completedAt);
  const tq = trackQuery.trim().toLowerCase();
  const trackingJobs = tq
    ? trackable.filter((h) =>
        [h.jobId, h.project, h.client, ...(h.materials || []).map((m) => m.name)]
          .join(" ")
          .toLowerCase()
          .includes(tq)
      )
    : trackable;

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
      {/* Wide enough for the table this page exists for. It was capped at
          1000px like a page of prose, which meant a horizontal scrollbar
          on a screen with 900px of empty margin either side. */}
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
              Stock
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              What's on the racks, and what stage each job's material is at
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button
              onClick={() => {
                load();
                loadJobs();
                          }}
              style={{ ...btn, padding: "6px 12px", fontSize: 13 }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs current="stock" tabs={caps.tabs} />

        <div
          style={{
            display: "inline-flex",
            background: "#efece5",
            borderRadius: 10,
            padding: 3,
            marginBottom: 16,
          }}
        >
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSection(s.key)}
              style={{
                border: "none",
                background: section === s.key ? "#fff" : "transparent",
                color: section === s.key ? BRAND.ink : BRAND.sub,
                fontWeight: section === s.key ? 600 : 500,
                fontSize: 14,
                padding: "8px 20px",
                borderRadius: 8,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: section === s.key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              }}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === "tracking" && (
          <div style={{ display: "flex", gap: 18, marginBottom: 16, borderBottom: `1px solid ${BRAND.line}` }}>
            {[
              { key: "project", label: "By project" },
              { key: "material", label: "By material" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTrackBy(t.key)}
                style={{
                  border: "none",
                  borderBottom: `2px solid ${trackBy === t.key ? BRAND.sub : "transparent"}`,
                  background: "none",
                  color: trackBy === t.key ? BRAND.ink : "#9c988f",
                  fontWeight: trackBy === t.key ? 600 : 400,
                  fontSize: 12,
                  padding: "0 0 7px",
                  marginBottom: -1,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}

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
        {/* What the last count came to. A correction of zero writes nothing,
            and somebody who has just walked to a rack deserves to be told that
            rather than left looking at an unchanged screen. */}
        {counted && (
          <div
            style={{
              background: "#eef4ef",
              border: `1px solid ${BRAND.green}`,
              color: BRAND.green,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
              display: "flex",
              gap: 10,
              alignItems: "baseline",
            }}
          >
            <span style={{ flex: 1 }}>{counted}</span>
            <button
              onClick={() => setCounted(null)}
              style={{ ...miniBtn, color: BRAND.green, borderColor: BRAND.green }}
            >
              Dismiss
            </button>
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
            Couldn&apos;t load material stock. {error}
          </div>
        )}

        {section === "hand" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by material"
                style={{
                  flex: 1,
                  border: `1px solid ${BRAND.line}`,
                  background: BRAND.card,
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 14,
                  fontFamily: "inherit",
                  boxSizing: "border-box",
                }}
              />
              {/* Putting a new material on the register is deciding what we
                  hold. Counting one that's already there isn't. */}
              <button
                onClick={() => setShowAdd((v) => !v)}
                disabled={!canKeep}
                style={{
                  border: `1px solid ${BRAND.green}`,
                  background: BRAND.green,
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: canKeep ? "pointer" : "default",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  opacity: canKeep ? 1 : 0.5,
                }}
              >
                + Add stock
              </button>
            </div>

            {showAdd && (
              /* key so the form remounts with whatever it's been handed. */
              <AddStockForm
                key={addInitial ? `${addInitial.finish}|${addInitial.thickness}` : "blank"}
                brand={BRAND}
                options={options}
                saving={saving}
                initial={addInitial}
                onCancel={() => {
                  setShowAdd(false);
                  setAddInitial(null);
                }}
                onSubmit={async (entry) => {
                  const ok = await submit({ ...entry, quantity: Math.abs(entry.quantity) });
                  if (ok) {
                    setShowAdd(false);
                    setAddInitial(null);
                  }
                }}
              />
            )}

            {!loading && productGroups.length === 0 && overdrawn.length === 0 && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                {balances.length === 0
                  ? "No material logged yet — leftovers from Duncan's board will show up here, or add some yourself."
                  : "Nothing on hand matches that filter."}
              </p>
            )}

            {overdrawn.length > 0 && (
              <div
                style={{
                  background: "#fbeceb",
                  border: `1px solid ${BRAND.red}`,
                  borderRadius: 10,
                  padding: "10px 14px",
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                <strong style={{ color: BRAND.red }}>
                  {overdrawn.length === 1 ? "One material has" : `${overdrawn.length} materials have`} been
                  drawn for jobs without ever being entered here
                </strong>
                <div style={{ color: BRAND.sub, marginTop: 2 }}>
                  The register can&apos;t show a negative box, so these would otherwise vanish off the
                  page — along with anything logged back against them. Usually it means the stock went
                  on a rack card under a different name, or was never added.
                </div>
                {overdrawn.map((b) => {
                  const sig = signature(b);
                  const drawn = b.entries.filter((e) => Number(e.quantity) < 0);
                  const back = b.entries.filter((e) => Number(e.quantity) > 0);
                  return (
                    <div key={sig} style={{ marginTop: 6 }}>
                      <strong>{b.name || "—"}</strong>{" "}
                      <span style={{ color: BRAND.sub }}>
                        {[b.length, b.width, b.thickness].filter(Boolean).join(" × ")}
                      </span>{" "}
                      <span style={{ color: BRAND.red, fontWeight: 600 }}>{b.total}</span>
                      <span style={{ color: BRAND.sub }}>
                        {" "}— {drawn.reduce((n, e) => n + Math.abs(Number(e.quantity) || 0), 0)} drawn
                        {back.length > 0 &&
                          `, ${back.reduce((n, e) => n + (Number(e.quantity) || 0), 0)} logged back`}
                        {back.length > 0 &&
                          ` (${[...new Set(back.map((e) => e.jobId).filter(Boolean))].join(", ") || "no job"})`}
                      </span>
                      <button
                        onClick={() => setExpanded((x) => ({ ...x, [sig]: !x[sig] }))}
                        style={{ ...miniBtn, marginLeft: 8 }}
                      >
                        {expanded[sig] ? "Hide" : `History (${b.entries.length})`}
                      </button>
                      {/* The two ways out: the sheets are on a rack and were
                          never entered, or they aren't and never were. */}
                      <button
                        onClick={() => {
                          const { finish, substrate } = splitMaterialName(b.name);
                          setAddInitial({
                            finish,
                            substrate,
                            length: String(dimension(b.length) ?? ""),
                            width: String(dimension(b.width) ?? ""),
                            thickness: String(dimension(b.thickness) ?? ""),
                            quantity: String(-Number(b.total) || ""),
                          });
                          setShowAdd(true);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        title="They're on a rack — enter what's actually there"
                        style={{ ...miniBtn, marginLeft: 6, color: BRAND.green, borderColor: BRAND.green }}
                      >
                        Enter what&apos;s on the rack
                      </button>
                      <button
                        onClick={() => writeOff(b)}
                        disabled={saving}
                        title="They aren't there — record the correction and bring it to zero"
                        style={{ ...miniBtn, marginLeft: 6, color: BRAND.sub }}
                      >
                        Write it off
                      </button>
                      {expanded[sig] && (
                        <div style={{ marginTop: 4, color: BRAND.sub, fontSize: 12 }}>
                          {b.entries.map((e) => (
                            <div key={e.id}>
                              {Number(e.quantity) > 0 ? "+" : ""}
                              {e.quantity} · {e.source || "manual"}
                              {e.jobId ? ` · ${e.jobId}` : ""}
                              {e.loggedBy ? ` · ${e.loggedBy}` : ""}
                              {e.loggedAt ? ` · ${fmtStamp(e.loggedAt)}` : ""}
                              {e.note ? ` · ${e.note}` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* One box per finish, several across. Everything under a finish —
                every substrate, every thickness — lives in its box and scrolls
                there, so the page stays the size of the number of finishes we
                hold rather than the number of sizes. */}
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                alignItems: "start",
              }}
            >
              {productGroups.map((group) => (
                <section
                  key={group.key}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.line}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
                  {/* The product: what you'd order. Substrate and thickness
                      say it once here rather than on every size below. */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{group.finish}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: 13,
                        fontWeight: 600,
                        color: group.free > 0 ? BRAND.green : BRAND.sub,
                      }}
                    >
                      {group.free} free
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 1 }}>
                    {[
                      group.thickness !== "" ? `${group.thickness}mm` : "",
                      group.substrate,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "no substrate recorded"}
                  </div>
                  {/* Only worth a line when some of it is spoken for. Each
                      claim counted once, however many sizes it sits across. */}
                  {group.reserved > 0 && (
                    <div style={{ fontSize: 12, color: BRAND.sub, marginTop: 2 }}>
                      {group.onHand} on hand · {group.reserved} spoken for ·{" "}
                      {group.rows.length} {group.rows.length === 1 ? "size" : "sizes"}
                    </div>
                  )}

                  {/* No scroll box: a product is held in a handful of sizes,
                      and a scrollbar over two rows hid one of them. */}
                  <div style={{ marginTop: 8 }}>
                    {group.rows.map((b) => {
                      const key = signature(b);
                      return (
                        <div
                          key={key}
                          style={{
                            borderTop: `1px solid ${BRAND.line}`,
                            paddingTop: 8,
                            marginTop: 8,
                          }}
                        >
                          {/* The size is the row. It's what gets ordered, what
                              gets picked, and — with two sizes of one board on
                              a rack — the only thing telling these apart. */}
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>
                              {b.length && b.width
                                ? `${dimension(b.length)} × ${dimension(b.width)}`
                                : "size not recorded"}
                            </span>
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 13,
                                fontWeight: 600,
                                color: b.free > 0 ? BRAND.green : BRAND.sub,
                              }}
                            >
                              {b.free} free
                            </span>
                          </div>
                          {b.reserved > 0 && (
                            <div style={{ fontSize: 12, color: BRAND.sub }}>
                              {b.total} on hand · {b.reserved} spoken for
                            </div>
                          )}

                          {/* The whole point of the colour: these sheets are on
                              the floor but already belong to a job. The job
                              number is what makes that actionable, and the
                              quantity is what makes the total above add up
                              rather than ask to be trusted. */}
                          {b.reserved > 0 && (b.claims?.length || b.reservedBy.length) && (
                            <div style={{ fontSize: 12, color: BRAND.red, fontWeight: 500 }}>
                              {b.claims?.length
                                ? b.claims.map((c) => `${c.jobId} (${c.quantity})`).join(" · ")
                                : b.reservedBy.join(", ")}
                            </div>
                          )}
                          {placedFor(b).length > 0 ? (
                            <div style={{ fontSize: 12, color: BRAND.sub }}>
                              {placedFor(b)
                                .map((p) =>
                                  placedFor(b).length === 1 ? p.bay : `${p.bay} (${p.quantity})`
                                )
                                .join(" · ")}
                            </div>
                          ) : b.location ? (
                            <div style={{ fontSize: 12, color: BRAND.sub }}>{b.location}</div>
                          ) : null}

                          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                            {/* Greyed rather than gone, the way the other
                                boards do it: what the page can do stays
                                visible, and the header says why it's out of
                                reach. */}
                            <button
                              onClick={() => setUseRow(useRow === key ? null : key)}
                              disabled={!canKeep}
                              style={{ ...miniBtn, opacity: canKeep ? 1 : 0.5 }}
                            >
                              − Use
                            </button>
                            <button
                              onClick={() => clearMaterial(b)}
                              disabled={saving || !canKeep}
                              title="Remove this material from the register — for something entered by mistake"
                              style={{
                                ...miniBtn,
                                color: BRAND.sub,
                                opacity: saving || !canKeep ? 0.5 : 1,
                              }}
                            >
                              Clear
                            </button>
                            {/* The warehouse's own button, and the only one
                                they get: what's actually on the rack,
                                whatever the register thinks. */}
                            <button
                              onClick={() => {
                                setCountRow(countRow === key ? null : key);
                                setCountDraft("");
                                setCounted(null);
                              }}
                              disabled={!canCount}
                              title="Count what's on the rack and correct the register to it"
                              style={{ ...miniBtn, color: BRAND.blue, opacity: canCount ? 1 : 0.5 }}
                            >
                              Count
                            </button>
                            {/* Where it lives, from the same list the plan is
                                drawn from — so putting a pallet down and
                                finding it later are the same vocabulary. */}
                            <button
                              onClick={() => setPlaceRow(placeRow === key ? null : key)}
                              disabled={!canCount}
                              title="Put this material on a bay"
                              style={{
                                ...miniBtn,
                                color: placedFor(b).length ? BRAND.ink : BRAND.blue,
                                opacity: canCount ? 1 : 0.5,
                              }}
                            >
                              {/* Where it is, in the button itself. More than
                                  one bay and it says so — naming only the
                                  first is how somebody ends up walking the
                                  warehouse looking for the other 450. */}
                              {placedFor(b).length === 0
                                ? "Location"
                                : placedFor(b).length === 1
                                  ? placedFor(b)[0].bay
                                  : `${placedFor(b).length} bays`}
                            </button>
                            <button
                              onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                              style={{
                                background: "none",
                                border: "none",
                                color: BRAND.blue,
                                fontSize: 12,
                                cursor: "pointer",
                                padding: 0,
                                fontFamily: "inherit",
                              }}
                            >
                              {expanded[key] ? "Hide" : `History (${b.entries.length})`}
                            </button>
                          </div>

                          {placeRow === key && (
                            <div
                              style={{
                                marginTop: 6,
                                padding: 8,
                                background: BRAND.bg,
                                borderRadius: 8,
                                display: "flex",
                                gap: 8,
                                alignItems: "center",
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ fontSize: 11, color: BRAND.sub }}>Where is it?</span>
                              <LocationPicker
                                value={locationCode(b.location)}
                                saving={saving}
                                loads={bayLoads}
                                capacities={capacities}
                                onChange={async (code) => {
                                  const ok = await savePlacements(
                                    b,
                                    code ? [{ bay: code, quantity: null }] : []
                                  );
                                  if (ok) setPlaceRow(null);
                                }}
                              />
                              <button onClick={() => setPlaceRow(null)} style={miniBtn}>
                                Cancel
                              </button>
                            </div>
                          )}

                          {/* Deliberately one box and one button. Somebody is
                              standing at a rack with a phone: the question is
                              how many are there, and the difference is the
                              register's problem, not theirs. */}
                          {countRow === key && (
                            <div
                              style={{
                                marginTop: 6,
                                padding: 8,
                                background: BRAND.bg,
                                borderRadius: 8,
                              }}
                            >
                              <div style={{ fontSize: 11, color: BRAND.sub, marginBottom: 4 }}>
                                How many are on the rack? The register says {b.total}.
                              </div>
                              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                <input
                                  autoFocus
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  value={countDraft}
                                  onChange={(ev) => setCountDraft(ev.target.value)}
                                  style={{
                                    width: 90,
                                    border: `1px solid ${BRAND.line}`,
                                    borderRadius: 6,
                                    padding: "4px 8px",
                                    fontSize: 13,
                                    fontFamily: "inherit",
                                  }}
                                />
                                <button
                                  onClick={async () => {
                                    const ok = await countStock(b, Number(countDraft));
                                    if (ok) {
                                      setCountRow(null);
                                      setCountDraft("");
                                    }
                                  }}
                                  disabled={saving || countDraft.trim() === "" || Number(countDraft) < 0}
                                  style={{
                                    ...miniBtn,
                                    color: BRAND.green,
                                    borderColor: BRAND.green,
                                    opacity: saving || countDraft.trim() === "" ? 0.6 : 1,
                                  }}
                                >
                                  {saving ? "Saving…" : "That's what's there"}
                                </button>
                                <button onClick={() => setCountRow(null)} style={miniBtn}>
                                  Cancel
                                </button>
                              </div>
                              {countDraft.trim() !== "" && Number(countDraft) !== b.total && (
                                <div style={{ fontSize: 11, color: BRAND.sub, marginTop: 4 }}>
                                  Logs {Number(countDraft) - b.total > 0 ? "+" : ""}
                                  {Number(countDraft) - b.total} against this material.
                                </div>
                              )}
                            </div>
                          )}

                          {useRow === key && (
                            <UseStockForm
                              brand={BRAND}
                              max={b.total}
                              jobs={jobs}
                              saving={saving}
                              onCancel={() => setUseRow(null)}
                              lineFor={(jobId) => lineForDraw(jobId, b)}
                              onSubmit={async (patch) => {
                                // Through the job's own line where there is
                                // one, so the schedule doesn't draw the same
                                // sheets again a day later.
                                const line = patch.jobId ? lineForDraw(patch.jobId, b) : null;
                                const ok = line
                                  ? await drawAgainstLine(
                                      patch.jobId,
                                      line.id,
                                      Math.abs(patch.quantity),
                                      patch.note
                                    )
                                  : await submit({
                                      name: b.name,
                                      length: b.length,
                                      width: b.width,
                                      thickness: b.thickness,
                                      quantity: -Math.abs(patch.quantity),
                                      jobId: patch.jobId,
                                      project: patch.project,
                                      note: patch.note,
                                    });
                                if (ok) setUseRow(null);
                              }}
                            />
                          )}

                          {expanded[key] && (
                            <div style={{ marginTop: 6 }}>
                              {b.entries.map((e) => (
                                <div
                                  key={e.id}
                                  style={{
                                    fontSize: 11,
                                    color: BRAND.sub,
                                    borderTop: `1px solid ${BRAND.line}`,
                                    padding: "3px 0",
                                  }}
                                >
                                  <span
                                    style={{
                                      color: e.quantity < 0 ? BRAND.red : BRAND.green,
                                      fontWeight: 500,
                                    }}
                                  >
                                    {e.quantity > 0 ? `+${e.quantity}` : e.quantity}
                                  </span>{" "}
                                  {e.source === "leftover"
                                    ? "Leftover"
                                    : e.source === "preorder"
                                      ? "Pre-order"
                                      : e.source === "scheduled"
                                        ? "Scheduled"
                                        : e.source === "count"
                                          ? "Counted"
                                          : "Manual"}
                                  {e.jobId ? ` · ${e.jobId}` : ""}
                                  {e.note ? ` · ${e.note}` : ""}
                                  {/* The note is the one part of an entry
                                      that can change: it's what somebody
                                      wanted the next person to know, and the
                                      next person may need telling something
                                      else. The numbers stay put. */}
                                  {noteEdit === e.id ? (
                                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                                      <input
                                        autoFocus
                                        value={noteDraft}
                                        onChange={(ev) => setNoteDraft(ev.target.value)}
                                        placeholder="What should the next person know?"
                                        style={{
                                          flex: 1,
                                          border: `1px solid ${BRAND.line}`,
                                          borderRadius: 6,
                                          padding: "3px 6px",
                                          fontSize: 11,
                                          fontFamily: "inherit",
                                          minWidth: 0,
                                        }}
                                      />
                                      <button
                                        onClick={async () => {
                                          const ok = await saveNote(e.id, noteDraft);
                                          if (ok) setNoteEdit(null);
                                        }}
                                        disabled={saving}
                                        style={{
                                          ...miniBtn,
                                          color: BRAND.green,
                                          borderColor: BRAND.green,
                                        }}
                                      >
                                        {saving ? "Saving…" : "Save"}
                                      </button>
                                      <button onClick={() => setNoteEdit(null)} style={miniBtn}>
                                        Cancel
                                      </button>
                                    </div>
                                  ) : (
                                    <button
                                      onClick={() => {
                                        setNoteEdit(e.id);
                                        setNoteDraft(e.note || "");
                                      }}
                                      title={e.note ? "Change this note" : "Add a note to this entry"}
                                      style={{
                                        ...miniBtn,
                                        marginLeft: 6,
                                        padding: "0 6px",
                                        color: BRAND.blue,
                                      }}
                                    >
                                      {e.note ? "Edit note" : "Add note"}
                                    </button>
                                  )}
                                  <div>
                                    {e.loggedBy} · {fmtStamp(e.loggedAt)}
                                    {/* Whoever wrote the note last, when it
                                        isn't whoever logged the entry. The
                                        original line stays theirs. */}
                                    {e.noteEditedAt
                                      ? ` · note edited by ${String(e.noteEditedBy || "").split("@")[0]} ${fmtStamp(e.noteEditedAt)}`
                                      : ""}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}

        {section === "tracking" && (
          <>
            <input
              value={trackQuery}
              onChange={(e) => setTrackQuery(e.target.value)}
              placeholder="Filter by job, project or material"
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
            <MaterialTracking jobs={trackingJobs} trackBy={trackBy} stockEntries={entries} />
          </>
        )}

        {section === "layout" && (
          <FactoryLayout
            byLocation={byLocation}
            unplaced={unplaced}
            bay={bay}
            bayRows={bayRows}
            onPick={(code) => setBay(bay === code ? null : code)}
            canPlace={canCount}
            saving={saving}
            onPlace={savePlacements}
            placedFor={placedFor}
            loads={bayLoads}
            capacities={capacities}
            onCapacities={saveCapacities}
          />
        )}
      </div>
    </main>
  );
}

/**
 * The factory as a plan, with what's on each bay.
 *
 * Not to scale and not trying to be: it's for finding a sheet, so what matters
 * is that the things next to each other on the floor are next to each other
 * here. Aisles run with position 01 at the dispatch end, the way the labels
 * are numbered, so the plan reads the way somebody walks it.
 */
function FactoryLayout({
  byLocation,
  unplaced,
  bay,
  bayRows,
  loads,
  onPick,
  canPlace,
  saving,
  onPlace,
  placedFor,
  capacities,
  onCapacities,
}) {
  const load = (code) => bayLoad(byLocation.get(code));
  const state = (code) => bayState(code, byLocation.get(code), capacities);
  // A proposed spread, held until somebody agrees to it. Nothing moves on the
  // strength of the app's arithmetic alone.
  const [spread, setSpread] = useState(null);
  // A proposal belongs to the bay it was worked out from; picking another one
  // leaves it meaningless.
  useEffect(() => {
    setSpread(null);
  }, [bay]);

  const bayStyle = (code) => {
    const tone = BAY_COLOURS[state(code)];
    const chosen = bay === code;
    return {
      fontSize: 10,
      lineHeight: 1.25,
      fontFamily: "inherit",
      padding: "2px 2px",
      // Every cell the same height whether or not it's carrying a figure, so
      // the aisles still read as rows.
      minHeight: 28,
      borderRadius: 3,
      cursor: "pointer",
      textAlign: "center",
      whiteSpace: "nowrap",
      background: tone.bg,
      color: tone.ink,
      border: chosen ? `2px solid ${BRAND.blue}` : `1px solid ${tone.border}`,
      fontWeight: state(code) === "empty" ? 400 : 600,
    };
  };

  const block = {
    background: "#eceae4",
    border: `1px solid ${BRAND.line}`,
    borderRadius: 8,
    padding: "10px 12px",
    fontSize: 12,
    color: BRAND.sub,
  };
  const strip = {
    background: "#efece5",
    border: `1px solid ${BRAND.line}`,
    borderRadius: 6,
    padding: "6px 10px",
    fontSize: 11,
    letterSpacing: "0.04em",
    color: BRAND.sub,
    textTransform: "uppercase",
  };

  return (
    <>
      <div style={{ fontSize: 13, color: BRAND.sub, marginBottom: 10 }}>
        Rack · column · position — A1-05 is rack A, column 1, five along. Racks D and E are
        addressed by zone instead: D3 is the whole block. Position 01 is the dispatch end.
      </div>

      <CapacityBar
        capacities={capacities}
        saving={saving}
        canEdit={canPlace}
        onSave={onCapacities}
      />

      <div
        style={{
          background: BRAND.card,
          border: `1px solid ${BRAND.line}`,
          borderRadius: 10,
          padding: 14,
          overflowX: "auto",
        }}
      >
        <div style={{ ...strip, marginBottom: 10, textAlign: "center" }}>
          Rear / external access road
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", minWidth: 900 }}>
          {/* Production. Mostly context — you're looking for a rack, and the
              machines are how you know which end of the building you're at —
              except the two floor stock areas, which hold sheets. */}
          <div style={{ flex: "0 0 300px" }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: BRAND.green, marginBottom: 6 }}>
              PRODUCTION
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {PRODUCTION_BLOCKS.map((row, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {row.map((cell, j) => {
                    const area = cell.area ? AREAS.find((a) => a.code === cell.area) : null;
                    if (!area) {
                      return (
                        <div key={j} style={block}>
                          <div style={{ color: BRAND.ink, fontWeight: 500 }}>{cell.name}</div>
                          {cell.note ? <div style={{ fontSize: 11 }}>{cell.note}</div> : null}
                        </div>
                      );
                    }
                    const tone = BAY_COLOURS[state(area.code)];
                    const on = load(area.code);
                    return (
                      <button
                        key={j}
                        onClick={() => onPick(area.code)}
                        style={{
                          ...block,
                          cursor: "pointer",
                          textAlign: "left",
                          fontFamily: "inherit",
                          background: tone.bg,
                          color: tone.ink,
                          border:
                            bay === area.code
                              ? `2px solid ${BRAND.blue}`
                              : `1px solid ${tone.border}`,
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{area.code}</div>
                        <div style={{ fontSize: 11 }}>
                          {on ? `${on} of ${capacityOf(area.code, capacities)}` : area.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* The warehouse: five racks, and no two the same shape. A, B and
              C are addressed bay by bay; D and E by zone, because what goes in
              them goes in as a pallet. */}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: BRAND.green, marginBottom: 6 }}>
              WAREHOUSE
            </div>
            {/* Bottom-aligned, because the racks are different lengths and
                they all finish at the same end of the building: position 01 of
                every one of them is at dispatch. Lining them up at the top
                would put C's 01 halfway up the wall. */}
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
              {RACKS.map((rack) => (
                <div key={rack.id} style={{ flex: rack.zones ? rack.columns : rack.columns }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      textAlign: "center",
                      marginBottom: 1,
                      color: BRAND.ink,
                    }}
                  >
                    {rack.label.toUpperCase()}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      textAlign: "center",
                      color: BRAND.sub,
                      marginBottom: 4,
                    }}
                  >
                    {rack.columns} wide · {rack.depth} deep
                    {rack.zones ? ` · ${rack.zones} zones` : ""}
                  </div>

                  {rack.zones ? (
                    /* A zone is the address. Drawn tall so it reads as the
                       block of racking it is rather than as one more shelf. */
                    <div style={{ display: "grid", gap: 3 }}>
                      {Array.from({ length: rack.zones }, (_, i) => rack.zones - i).map((z) => {
                        const code = zoneCode(rack.id, z);
                        const on = load(code);
                        return (
                          <button
                            key={code}
                            onClick={() => onPick(code)}
                            title={
                              on
                                ? `${code} — ${on} of ${capacityOf(code, capacities)}`
                                : `${code} — empty`
                            }
                            style={{ ...bayStyle(code), minHeight: 46, fontSize: 12 }}
                          >
                            {code}
                            <div style={{ fontSize: 9, fontWeight: 400 }}>
                              {on ? `${on}/${capacityOf(code, capacities)}` : " "}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 3 }}>
                      {Array.from({ length: rack.columns }, (_, i) => i + 1).map((column) => (
                        <div key={column} style={{ flex: 1 }}>
                          <div
                            style={{
                              fontSize: 9,
                              textAlign: "center",
                              color: BRAND.sub,
                              marginBottom: 3,
                            }}
                          >
                            {rack.id}
                            {column}
                          </div>
                          <div style={{ display: "grid", gap: 2 }}>
                            {/* Counted down the page so 01, the dispatch end,
                                sits at the bottom where dispatch is. */}
                            {Array.from({ length: rack.depth }, (_, i) => rack.depth - i).map((p) => {
                              const code = bayCode(rack.id, column, p);
                              const on = load(code);
                              return (
                                <button
                                  key={code}
                                  onClick={() => onPick(code)}
                                  title={
                                    on
                                      ? `${code} — ${on} of ${capacityOf(code, capacities)}`
                                      : `${code} — empty`
                                  }
                                  style={bayStyle(code)}
                                >
                                  {code}
                                  {/* The number is the point once a bay can be
                                      part full: 280 here and 20 next door is a
                                      normal afternoon. */}
                                  <div style={{ fontSize: 9, fontWeight: 400 }}>
                                    {on ? `${on}/${capacityOf(code, capacities)}` : " "}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: BRAND.sub, textAlign: "center", marginTop: 4 }}>
                    {rack.zones ? `${rack.id}1 nearest dispatch` : "01 starts here"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            ...strip,
            marginTop: 10,
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
          }}
        >
          <span>Front / car park &amp; loading side</span>
          {AREAS.filter((a) => a.where === "front").map((a) => {
            const tone = BAY_COLOURS[state(a.code)];
            const on = load(a.code);
            return (
              <button
                key={a.code}
                onClick={() => onPick(a.code)}
                style={{
                  fontSize: 11,
                  fontFamily: "inherit",
                  padding: "3px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  textTransform: "none",
                  letterSpacing: 0,
                  background: tone.bg,
                  color: tone.ink,
                  border:
                    bay === a.code ? `2px solid ${BRAND.blue}` : `1px solid ${tone.border}`,
                }}
              >
                {a.code} {a.label}
                {on ? ` · ${on}` : ""}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 12, fontSize: 11, color: BRAND.sub }}>
          {[
            { key: "empty", label: "Empty" },
            { key: "holding", label: "Has stock on it" },
            // No single number any more: a bay on C is full at one figure and
            // a zone on D at another, so the legend says what full means
            // rather than pretending the warehouse is one shape.
            { key: "full", label: "Full for its section" },
          ].map((k) => (
            <span key={k.key}>
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  background: BAY_COLOURS[k.key].bg,
                  border: `1px solid ${BAY_COLOURS[k.key].border}`,
                  borderRadius: 2,
                  marginRight: 5,
                }}
              />
              {k.label}
            </span>
          ))}
          <span style={{ marginLeft: "auto" }}>Diagrammatic — not to scale</span>
        </div>
      </div>

      {/* What's on the bay you picked. The point of the whole page. */}
      <div style={{ marginTop: 16 }}>
        {!bay ? (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            Pick a bay to see what&apos;s on it. {byLocation.size} of {allLocations().length} are
            holding something.
          </p>
        ) : (
          <>
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 2px" }}>
              {bay} <span style={{ fontWeight: 400, color: BRAND.sub }}>· {describeLocation(bay)}</span>
            </h2>
            {/* How full, in one line and one bar. Several materials on one bay
                is normal — 280 of a board and 50 of something else stacked on
                the twenty that were left — so the figure that matters is the
                bay's, not any one material's. */}
            {bayRows.length > 0 && (
              <div style={{ margin: "4px 0 10px", maxWidth: 420 }}>
                <div style={{ fontSize: 12, color: BRAND.sub, marginBottom: 3 }}>
                  {load(bay)} of {capacityOf(bay, capacities)} sheets
                  {load(bay) >= capacityOf(bay, capacities)
                    ? load(bay) > capacityOf(bay, capacities)
                      ? ` · ${load(bay) - capacityOf(bay, capacities)} over`
                      : " · full"
                    : ` · room for ${capacityOf(bay, capacities) - load(bay)} more`}
                  {bayRows.length > 1 ? ` · ${bayRows.length} materials` : ""}
                </div>
                {/* Over capacity is a question, not a verdict: the sheets are
                    going somewhere, and the plan may as well say where. */}
                {load(bay) > capacityOf(bay, capacities) && canPlace && (
                  <div style={{ marginTop: 6 }}>
                    {spread ? (
                      <div
                        style={{
                          background: BRAND.bg,
                          borderRadius: 8,
                          padding: 10,
                          fontSize: 12,
                        }}
                      >
                        <div style={{ marginBottom: 6 }}>
                          <strong style={{ fontWeight: 600 }}>{spread.row.name}</strong> —{" "}
                          {spread.row.total} sheets across{" "}
                          {spread.plan.length === 1 ? "1 bay" : `${spread.plan.length} bays`}:
                        </div>
                        <div style={{ display: "grid", gap: 3, marginBottom: 8 }}>
                          {spread.plan.map((p) => (
                            <div key={p.bay}>
                              <span style={{ fontWeight: 600 }}>{p.bay}</span> · {p.quantity}
                              {p.bay === bay ? " (stays here)" : ""}
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            onClick={async () => {
                              const ok = await onPlace(spread.row, spread.plan);
                              if (ok) setSpread(null);
                            }}
                            disabled={saving}
                            style={{
                              ...miniBtn,
                              color: BRAND.green,
                              borderColor: BRAND.green,
                              opacity: saving ? 0.6 : 1,
                            }}
                          >
                            {saving ? "Moving…" : "Put them there"}
                          </button>
                          <button onClick={() => setSpread(null)} style={miniBtn}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {bayRows.map((r) => (
                          <button
                            key={signature(r)}
                            onClick={() =>
                              setSpread({
                                row: r,
                                plan: spreadFrom(
                                  bay,
                                  r.total,
                                  loads,
                                  // This material's own sheets don't count
                                  // against the room it's being offered.
                                  new Map(placedFor(r).map((p) => [p.bay, p.quantity])),
                                  capacities
                                ),
                              })
                            }
                            style={{ ...miniBtn, color: BRAND.blue }}
                          >
                            Spread {bayRows.length > 1 ? r.name : "the overflow"} across bays
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: "#efece5",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, (load(bay) / capacityOf(bay, capacities)) * 100)}%`,
                      height: "100%",
                      background: BAY_COLOURS[state(bay)].border,
                    }}
                  />
                </div>
              </div>
            )}
            {bayRows.length === 0 ? (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                Nothing on this one. Anything below can be put here.
              </p>
            ) : (
              <div
                style={{
                  background: BRAND.card,
                  border: `1px solid ${BRAND.line}`,
                  borderRadius: 10,
                  overflowX: "auto",
                  marginTop: 8,
                }}
              >
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={th}>Material</th>
                      <th style={th}>Size</th>
                      <th style={{ ...th, textAlign: "right" }}>On hand</th>
                      <th style={{ ...th, textAlign: "right" }}>Spoken for</th>
                      <th style={{ ...th, textAlign: "right" }}>Free</th>
                      {canPlace && <th style={{ ...th, textAlign: "right" }}>Move</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {bayRows.map((r) => (
                      <tr key={signature(r)}>
                        <td style={{ ...td, whiteSpace: "normal", minWidth: 160 }}>{r.name}</td>
                        <td style={td}>
                          {dimension(r.length)} × {dimension(r.width)}
                          {r.thickness ? ` × ${dimension(r.thickness)}` : ""}
                        </td>
                        <td style={{ ...td, textAlign: "right" }}>
                          {r.here}
                          {/* What's here against what we hold, when they're
                              not the same thing — the rest is on other bays. */}
                          {r.here !== r.total && (
                            <div style={{ fontSize: 11, color: BRAND.sub }}>of {r.total}</div>
                          )}
                        </td>
                        <td style={{ ...td, textAlign: "right", color: BRAND.sub }}>
                          {r.reserved || "—"}
                        </td>
                        <td
                          style={{
                            ...td,
                            textAlign: "right",
                            fontWeight: 600,
                            color: r.free > 0 ? BRAND.green : BRAND.sub,
                          }}
                        >
                          {r.free}
                        </td>
                        {canPlace && (
                          <td style={{ ...td, textAlign: "right" }}>
                            <LocationPicker
                              value={bay}
                              saving={saving}
                              loads={loads}
                          capacities={capacities}
                              capacities={capacities}
                              onChange={(code) =>
                                onPlace(r, code ? [{ bay: code, quantity: null }] : [])
                              }
                            />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* The list that finishes the map. Everything the register holds that
          nobody has said where it is. */}
      {unplaced.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 2px" }}>
            Not on the map yet ({unplaced.length})
          </h2>
          <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 8px" }}>
            On the racks somewhere, but without a bay against it. Whatever was typed before is
            kept until somebody picks one.
          </p>
          <div
            style={{
              background: BRAND.card,
              border: `1px solid ${BRAND.line}`,
              borderRadius: 10,
              overflowX: "auto",
            }}
          >
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <tbody>
                {unplaced.map((r) => (
                  <tr key={signature(r)}>
                    <td style={{ ...td, whiteSpace: "normal", minWidth: 160 }}>{r.name}</td>
                    <td style={td}>
                      {dimension(r.length)} × {dimension(r.width)}
                      {r.thickness ? ` × ${dimension(r.thickness)}` : ""}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{r.total}</td>
                    <td style={{ ...td, color: BRAND.sub, whiteSpace: "normal" }}>
                      {r.location || "no location recorded"}
                    </td>
                    {canPlace && (
                      <td style={{ ...td, textAlign: "right" }}>
                        <LocationPicker
                          value=""
                          saving={saving}
                          loads={loads}
                          capacities={capacities}
                          onChange={(code) =>
                            onPlace(r, code ? [{ bay: code, quantity: null }] : [])
                          }
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Picking a bay.
 *
 * A list rather than a box to type in, for the same reason the material names
 * are a list: "2A7" and "2-A-07" and "aisle 2 A 7" are one shelf, and a map
 * built from three spellings of it isn't a map.
 */
function LocationPicker({ value, saving, onChange, loads, capacities }) {
  // What's already there, in the option itself, so somebody putting a pallet
  // down can see where there's room without closing the list to check.
  const label = (code) => {
    const on = loads?.get(code) ?? 0;
    if (!on) return code;
    const cap = capacityOf(code, capacities);
    return on >= cap ? `${code} · full (${on})` : `${code} · ${on}/${cap}`;
  };
  return (
    <select
      value={value || ""}
      disabled={saving}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 12,
        fontFamily: "inherit",
        padding: "3px 6px",
        borderRadius: 6,
        border: `1px solid ${BRAND.line}`,
        background: BRAND.card,
        maxWidth: 170,
      }}
    >
      <option value="">— nowhere yet —</option>
      <optgroup label="Floor & dispatch">
        {AREAS.map((a) => (
          <option key={a.code} value={a.code}>
            {a.code} · {a.label}
          </option>
        ))}
      </optgroup>
      {RACKS.map((rack) =>
        rack.zones ? (
          <optgroup key={rack.id} label={`${rack.label} · zones`}>
            {Array.from({ length: rack.zones }, (_, i) => i + 1).map((z) => (
              <option key={z} value={zoneCode(rack.id, z)}>
                {label(zoneCode(rack.id, z))}
              </option>
            ))}
          </optgroup>
        ) : (
          Array.from({ length: rack.columns }, (_, i) => i + 1).map((column) => (
            <optgroup key={`${rack.id}${column}`} label={`${rack.label} · column ${column}`}>
              {Array.from({ length: rack.depth }, (_, i) => i + 1).map((p) => (
                <option key={p} value={bayCode(rack.id, column, p)}>
                  {label(bayCode(rack.id, column, p))}
                </option>
              ))}
            </optgroup>
          ))
        )
      )}
    </select>
  );
}

/**
 * How many sheets each section holds.
 *
 * At the top of the plan rather than buried in a settings page, because the
 * figures in the code are guesses and the person who can correct them is the
 * one standing in front of the rack wondering why it's red.
 */
function CapacityBar({ capacities, saving, canEdit, onSave }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(capacities);

  useEffect(() => {
    setDraft(capacities);
  }, [capacities]);

  const sections = [
    ...RACKS.map((r) => ({
      key: r.id,
      label: r.zones ? `${r.label} (per zone)` : `${r.label} (per bay)`,
    })),
    { key: "FLOOR", label: "Floor & dispatch" },
  ];

  if (!open) {
    return (
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          flexWrap: "wrap",
          fontSize: 12,
          color: BRAND.sub,
          marginBottom: 10,
        }}
      >
        <span>Max sheets:</span>
        {sections.map((s) => (
          <span key={s.key}>
            <strong style={{ color: BRAND.ink, fontWeight: 600 }}>{s.key}</strong>{" "}
            {capacities[s.key] ?? DEFAULT_CAPACITIES[s.key]}
          </span>
        ))}
        {canEdit && (
          <button onClick={() => setOpen(true)} style={{ ...miniBtn, color: BRAND.blue }}>
            Adjust
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        background: BRAND.card,
        border: `1px solid ${BRAND.line}`,
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ fontSize: 12, color: BRAND.sub, marginBottom: 8 }}>
        How many sheets each section holds. A bay on A, B or C is one shelf; a zone on D or E is
        the whole block, so it takes several times as many.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {sections.map((s) => (
          <label key={s.key} style={{ fontSize: 11, color: BRAND.sub }}>
            <div style={{ marginBottom: 2 }}>{s.label}</div>
            <input
              type="number"
              min="1"
              value={draft[s.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, [s.key]: e.target.value })}
              style={{
                width: 90,
                border: `1px solid ${BRAND.line}`,
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 13,
                fontFamily: "inherit",
              }}
            />
          </label>
        ))}
        <button
          onClick={async () => {
            const ok = await onSave(draft);
            if (ok) setOpen(false);
          }}
          disabled={saving}
          style={{
            ...miniBtn,
            color: BRAND.green,
            borderColor: BRAND.green,
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => {
            setDraft(capacities);
            setOpen(false);
          }}
          style={miniBtn}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Where each material actually is, read straight off Duncan's schedule board
// rather than anyone asking around the factory.
function MaterialTracking({ jobs, trackBy, stockEntries }) {
  if (jobs.length === 0) {
    return <p style={{ fontSize: 13, color: BRAND.sub }}>Nothing handed over yet.</p>;
  }

  if (trackBy === "project") {
    return (
      <div style={{ display: "grid", gap: 12 }}>
        {jobs.map((h) => {
          const fromStock = stockForJob(stockEntries, h.jobId);
          return (
            <section
              key={h.jobId}
              style={{
                background: "#fff",
                border: `1px solid ${BRAND.line}`,
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{h.jobId}</span>
                <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                <span style={{ marginLeft: "auto" }}>
                  <StageBadge handover={h} />
                </span>
              </div>
              {(h.materials || []).length === 0 ? (
                <p style={{ fontSize: 13, color: BRAND.sub, margin: 0 }}>No materials listed yet.</p>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: BRAND.sub }}>
                      <th style={{ fontWeight: 500, padding: "2px 0" }}>Size</th>
                      <th style={{ fontWeight: 500, width: 70 }}>Qty</th>
                      <th style={{ fontWeight: 500 }}>Material</th>
                      <th style={{ fontWeight: 500, width: 110 }}>Order status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(h.materials || []).map((m) => (
                      <tr key={m.id} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                        <td style={{ padding: "6px 0" }}>{size(m)}</td>
                        <td>{m.quantity || "—"}</td>
                        <td>{m.name || "—"}</td>
                        <td style={{ color: BRAND.sub }}>{effectiveState(m).replace("_", " ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {fromStock.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: BRAND.red, fontWeight: 500 }}>
                  {fromStock.map((s, i) => (
                    <div key={i}>
                      From stock: {s.qty} × {s.name}
                      {s.size ? ` (${s.size})` : ""}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // By material: the same lines, regrouped so every job needing "Blackbutt
  // NTV" (say) shows in one place regardless of which job it's for.
  const groups = buildMaterialGroups(jobs);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {groups.map((g) => (
        <section
          key={materialSignature(g)}
          style={{
            background: "#fff",
            border: `1px solid ${BRAND.line}`,
            borderRadius: 10,
            padding: "14px 16px",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            {g.name || "—"}
            {g.length && g.width ? (
              <span style={{ fontWeight: 400, color: BRAND.sub, marginLeft: 8 }}>
                {g.length} × {g.width}
                {g.thickness ? ` × ${g.thickness}` : ""}
              </span>
            ) : null}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: BRAND.sub }}>
                <th style={{ fontWeight: 500, padding: "2px 0" }}>Job</th>
                <th style={{ fontWeight: 500 }}>Project</th>
                <th style={{ fontWeight: 500, width: 70 }}>Qty</th>
                <th style={{ fontWeight: 500, width: 110 }}>Order status</th>
                <th style={{ fontWeight: 500, width: 130 }}>Stage</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map((r) => (
                <tr key={`${r.jobId}:${r.id}`} style={{ borderTop: `1px solid ${BRAND.line}` }}>
                  <td style={{ padding: "6px 0" }}>{r.jobId}</td>
                  <td>{r.project || "—"}</td>
                  <td>{r.quantity || "—"}</td>
                  <td style={{ color: BRAND.sub }}>{effectiveState(r).replace("_", " ")}</td>
                  <td>
                    <StageBadge handover={r.handover} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/** "Smartlook Blackbutt" + "FR MDF" → "Smartlook Blackbutt on FR MDF". */
function materialNameOf(finish, substrate) {
  return [finish.trim(), substrate.trim()].filter(Boolean).join(" on ");
}

/**
 * A dropdown of what we sell, with "Other…" for what we don't.
 *
 * Same shape as the handover's picker, and for the same reason: the list is
 * what keeps the names identical across the two apps, and the escape hatch is
 * what stops a one-off finish from being forced into the nearest wrong one.
 */

function AddStockForm({ brand, onSubmit, onCancel, saving, options, initial = null }) {
  // Two halves rather than one free-text name, the same as the handover's
  // picking list. If Alice types "Tas Oak" while Mitch picks "Smartlook
  // Tasmanian Oak", the register holds material his job can't find.
  const [finish, setFinish] = useState(initial?.finish ?? "");
  const [substrate, setSubstrate] = useState(initial?.substrate ?? "");
  const name = materialNameOf(finish, substrate);
  const [length, setLength] = useState(initial?.length ?? "");
  const [width, setWidth] = useState(initial?.width ?? "");
  const [thickness, setThickness] = useState(initial?.thickness ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [note, setNote] = useState(initial?.note ?? "");

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div
      style={{
        background: brand.card,
        border: `1px solid ${brand.line}`,
        borderRadius: 10,
        padding: 16,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 90px 90px 90px 80px", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Finish</label>
          <PickOne
            style={input}
            value={finish}
            onChange={setFinish}
            options={options.finishes}
            label="Finish"
            listOnly
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Substrate</label>
          <PickOne
            style={input}
            value={substrate}
            onChange={setSubstrate}
            options={options.substrates}
            label="Substrate"
            listOnly
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Length</label>
          <input style={input} value={length} onChange={(e) => setLength(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Width</label>
          <input style={input} value={width} onChange={(e) => setWidth(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Thick</label>
          <input style={input} value={thickness} onChange={(e) => setThickness(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Qty</label>
          <input type="number" style={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Where it is (optional)</label>
          <input style={input} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Rack 3, near CNC" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!name.trim() || !Number(quantity) || saving}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              length,
              width,
              thickness,
              quantity: Number(quantity) || 0,
              location: location.trim(),
              note: note.trim(),
            })
          }
          style={{
            border: `1px solid ${brand.green}`,
            background: brand.green,
            color: "#fff",
            borderRadius: 8,
            padding: "6px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
            opacity: !name.trim() || !Number(quantity) || saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Add"}
        </button>
        <button
          onClick={onCancel}
          style={{
            border: `1px solid ${brand.line}`,
            background: brand.card,
            color: brand.sub,
            borderRadius: 8,
            padding: "6px 16px",
            fontSize: 13,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Search-as-you-type over the live job list, so assigning stock to a job
// means picking the real CRM rather than typing something that might not
// match anything on the schedule board.
function JobPicker({ brand, jobs, value, onChange, placeholder }) {
  const [text, setText] = useState(value ? `${value.jobId} — ${value.project || ""}` : "");
  const [open, setOpen] = useState(false);

  const q = text.trim().toLowerCase();
  const matches = q
    ? jobs
        .filter((j) => `${j.jobId} ${j.project || j.client || ""}`.toLowerCase().includes(q))
        .slice(0, 8)
    : [];

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        style={input}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && matches.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "#fff",
            border: `1px solid ${brand.line}`,
            borderRadius: 6,
            marginTop: 2,
            zIndex: 10,
            maxHeight: 180,
            overflowY: "auto",
            boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
          }}
        >
          {matches.map((j) => (
            <div
              key={j.jobId}
              onMouseDown={() => {
                const picked = { jobId: j.jobId, project: j.project || j.client || "" };
                onChange(picked);
                setText(`${picked.jobId} — ${picked.project}`);
                setOpen(false);
              }}
              style={{ padding: "6px 10px", fontSize: 13, cursor: "pointer" }}
            >
              <strong>{j.jobId}</strong> {j.project || j.client || ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UseStockForm({ brand, max, jobs, onSubmit, onCancel, saving, lineFor }) {
  const [quantity, setQuantity] = useState("");
  const [job, setJob] = useState(null);
  const [note, setNote] = useState("");

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
  };

  const qty = Number(quantity) || 0;
  const valid = qty > 0 && qty <= max;
  const matched = job && lineFor ? lineFor(job.jobId) : null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${brand.line}` }}>
      <div>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>How many (of {max})</label>
        <input type="number" style={{ ...input, width: 80 }} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>
      <div style={{ width: 220 }}>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>Assign to a job (optional)</label>
        <JobPicker brand={brand} jobs={jobs} value={job} onChange={setJob} placeholder="Search CRM or project" />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <label style={{ fontSize: 11, color: brand.sub, display: "block" }}>Note (optional)</label>
        <input style={{ ...input, width: "100%", boxSizing: "border-box" }} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      {/* When the job's picking list already asks for this material, the
          draw goes through that line rather than beside it — so the schedule
          doesn't take the same sheets off again when Duncan dates the job. */}
      {matched && (
        <div style={{ fontSize: 11, color: brand.green, flexBasis: "100%", order: 9 }}>
          {job.jobId} has this on its picking list as In stock — confirming that line and marking it
          drawn, so it can only come off the register once.
        </div>
      )}
      <button
        disabled={!valid || saving}
        onClick={() =>
          onSubmit({
            quantity: qty,
            jobId: job?.jobId || null,
            project: job?.project || "",
            note: note.trim(),
          })
        }
        style={{
          border: `1px solid ${brand.red}`,
          background: brand.red,
          color: "#fff",
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
          opacity: !valid || saving ? 0.6 : 1,
        }}
      >
        {saving ? "Saving…" : "Confirm use"}
      </button>
      <button
        onClick={onCancel}
        style={{
          border: `1px solid ${brand.line}`,
          background: brand.card,
          color: brand.sub,
          borderRadius: 8,
          padding: "6px 14px",
          fontSize: 13,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

// Alice or Jordan getting ahead of a job that hasn't been handed over yet.
// The CRM is typed by hand and doesn't have to match anything — once a
