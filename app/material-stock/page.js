"use client";

import { useCallback, useEffect, useMemo, useState, Fragment } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { PROCESS_COLUMNS, CELL_COLOURS, cellState } from "../../lib/board.js";
import { groupByFinish } from "../../lib/materialGroups.js";

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

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

function signature(e) {
  return [
    String(e.name || "").trim().toLowerCase(),
    String(e.length ?? "").trim(),
    String(e.width ?? "").trim(),
    String(e.thickness ?? "").trim(),
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
  { key: "preorders", label: "Pre-orders" },
  { key: "tracking", label: "Tracking" },
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
  const [preOrders, setPreOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [query, setQuery] = useState("");
  const [trackQuery, setTrackQuery] = useState("");
  const [trackBy, setTrackBy] = useState("project");
  const [section, setSection] = useState("hand");
  const [user, setUser] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showPreOrder, setShowPreOrder] = useState(false);
  const [useRow, setUseRow] = useState(null); // signature of the row being drawn down
  const [expanded, setExpanded] = useState({});
  const [saving, setSaving] = useState(false);
  const [preOrderSaving, setPreOrderSaving] = useState(false);
  const [deleteId, setDeleteId] = useState(null); // pre-order id whose delete-confirm row is open
  const [deleteText, setDeleteText] = useState("");
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

  // For the job picker on "Use", for pre-order CRM matching, and for the
  // Tracking section — all three need the live job list.
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

  const loadPreOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/pre-orders", { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setPreOrders(json.preOrders || []);
    } catch {
      // Pre-orders just won't show until the next successful refresh.
    }
  }, []);

  useEffect(() => {
    load();
    loadAvailable();
    loadOptions();
    loadJobs();
    loadPreOrders();
    const id = setInterval(() => {
      load();
      loadAvailable();
      loadJobs();
      loadPreOrders();
    }, REFRESH_MS);
    const onFocus = () => {
      load();
      loadAvailable();
      loadJobs();
      loadPreOrders();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, loadAvailable, loadOptions, loadJobs, loadPreOrders]);

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

  const setPreOrder = useCallback(async (id, patch) => {
    let idToken = null;
    const claiming = patch.state === "ordered" || patch.state === "completed" || patch.state === "cancelled";
    if (claiming) {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      idToken = await current.getIdToken();
    } else if (firebaseConfigured() && auth().currentUser) {
      idToken = await auth().currentUser.getIdToken();
    }

    setPending((p) => ({ ...p, [`preorder:${id}`]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/pre-orders/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setPreOrders((prev) => prev.map((p) => (p.id === id ? json.preOrder : p)));
    } catch (e) {
      setActionError(`Couldn't update that pre-order. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [`preorder:${id}`]: false }));
    }
  }, []);

  const addPreOrder = useCallback(async (entry) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setPreOrderSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...entry, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setPreOrders((prev) => [json.preOrder, ...prev]);
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setPreOrderSaving(false);
    }
  }, []);

  // The CRM never turned into a real job — folds the pre-order into general
  // stock (still coming, just not earmarked for a specific job anymore)
  // rather than leaving it stuck waiting forever.
  const movePreOrderToStock = useCallback(async (id) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    setPending((p) => ({ ...p, [`preorder:${id}`]: true }));
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/move-to-stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setPreOrders((prev) => prev.map((p) => (p.id === id ? json.preOrder : p)));
      setEntries((prev) => (json.stockEntry ? [json.stockEntry, ...prev] : prev));
    } catch (e) {
      setActionError(`Couldn't move that pre-order to stock. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [`preorder:${id}`]: false }));
    }
  }, []);

  /**
   * The pre-order turned up.
   *
   * Whatever jobs have claimed off their picking lists gets marked received
   * against those lines, and the balance becomes ordinary stock — which is
   * where the whole delivery would have gone if nobody had claimed any of it.
   * Alice types what actually arrived only when it isn't what was ordered.
   */
  const preOrderArrived = useCallback(async (po) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const typed = window.prompt(
      [
        `${po.name} — how many turned up?`,
        "",
        po.reserved > 0
          ? `${po.reserved} of these are claimed by ${po.reservedBy
              .map((r) => r.jobId)
              .join(", ")}. Those get filled first; the rest goes into stock.`
          : "Nothing is claimed against it, so all of it goes into stock.",
      ].join("\n"),
      String(po.quantity ?? "")
    );
    if (typed === null) return;

    setPending((p) => ({ ...p, [`preorder:${po.id}`]: true }));
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/arrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: po.id, arrived: typed.trim(), idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      // Everything moved at once, so reload rather than patching three lists
      // and hoping they agree.
      load();
      loadPreOrders();
      loadJobs();
      if (json.short > 0) {
        setActionError(
          `Recorded. ${json.short} short of what jobs had claimed — those lines are still outstanding.`
        );
      }
    } catch (e) {
      setActionError(`Couldn't record that arrival. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [`preorder:${po.id}`]: false }));
    }
  }, [load, loadPreOrders, loadJobs]);

  // Genuinely erases it — for a mis-entry, not for "don't need this
  // anymore" (that's Cancel, which keeps the record).
  const deletePreOrder = useCallback(async (id) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    setPending((p) => ({ ...p, [`preorder:${id}`]: true }));
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Delete failed");
      setPreOrders((prev) => prev.filter((p) => p.id !== id));
      setDeleteId(null);
      setDeleteText("");
    } catch (e) {
      setActionError(`Couldn't delete that pre-order. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [`preorder:${id}`]: false }));
    }
  }, []);

  const balances = useMemo(() => balancesFrom(entries), [entries]);
  const q = query.trim().toLowerCase();
  const matchingBalances = q ? balances.filter((b) => (b.name || "").toLowerCase().includes(q)) : balances;
  const onHand = matchingBalances.filter((b) => b.total > 0);
  const finishGroups = useMemo(
    () => groupByFinish(onHand, available),
    // onHand is rebuilt each render from balances and the filter, so depend on
    // what actually decides it rather than on the array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [balances, q, available]
  );

  const jobById = new Map(jobs.map((h) => [String(h.jobId).trim().toLowerCase(), h]));
  const activePreOrders = preOrders.filter((po) => po.state !== "cancelled" && po.state !== "moved_to_stock");

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
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
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
              What's in the factory, what's pre-ordered, and what stage each job's material is at
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button
              onClick={() => {
                load();
                loadJobs();
                loadPreOrders();
              }}
              style={{ ...btn, padding: "6px 12px", fontSize: 13 }}
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs current="stock" />

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
              {s.key === "preorders" && activePreOrders.length > 0 ? ` (${activePreOrders.length})` : ""}
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
              <button
                onClick={() => setShowAdd((v) => !v)}
                style={{
                  border: `1px solid ${BRAND.green}`,
                  background: BRAND.green,
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                + Add stock
              </button>
            </div>

            {showAdd && (
              <AddStockForm
                brand={BRAND}
                options={options}
                saving={saving}
                onCancel={() => setShowAdd(false)}
                onSubmit={async (entry) => {
                  const ok = await submit({ ...entry, quantity: Math.abs(entry.quantity) });
                  if (ok) setShowAdd(false);
                }}
              />
            )}

            {!loading && finishGroups.length === 0 && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                {balances.length === 0
                  ? "No material logged yet — leftovers from Duncan's board will show up here, or add some yourself."
                  : "Nothing on hand matches that filter."}
              </p>
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
              {finishGroups.map((group) => (
                <section
                  key={group.finish}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${BRAND.line}`,
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}
                >
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
                  {/* Only worth a line when some of it is spoken for. */}
                  {group.reserved > 0 && (
                    <div style={{ fontSize: 12, color: BRAND.red, marginTop: 2 }}>
                      {group.onHand} on hand · {group.reserved} reserved
                    </div>
                  )}

                  <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8 }}>
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
                          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span style={{ fontSize: 13 }}>{b.substrate || "—"}</span>
                            {b.thickness ? (
                              <span style={{ fontSize: 13, color: BRAND.sub }}>
                                {b.thickness}mm
                              </span>
                            ) : null}
                            <span
                              style={{
                                marginLeft: "auto",
                                fontSize: 13,
                                fontWeight: 600,
                                color: b.free > 0 ? BRAND.green : BRAND.sub,
                              }}
                            >
                              {b.free}
                            </span>
                          </div>
                          {b.length && b.width ? (
                            <div style={{ fontSize: 12, color: BRAND.sub }}>
                              {b.length} × {b.width}
                              {b.location ? ` · ${b.location}` : ""}
                            </div>
                          ) : b.location ? (
                            <div style={{ fontSize: 12, color: BRAND.sub }}>{b.location}</div>
                          ) : null}

                          {/* The whole point of the colour: these sheets are on
                              the floor but already belong to a job, and the job
                              number is what makes that actionable. */}
                          {b.reserved > 0 && (
                            <div style={{ fontSize: 12, color: BRAND.red, fontWeight: 500 }}>
                              {b.reserved} reserved
                              {b.reservedBy.length ? ` · ${b.reservedBy.join(", ")}` : ""}
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                            <button onClick={() => setUseRow(useRow === key ? null : key)} style={miniBtn}>
                              − Use
                            </button>
                            <button
                              onClick={() => clearMaterial(b)}
                              disabled={saving}
                              title="Remove this material from the register — for something entered by mistake"
                              style={{ ...miniBtn, color: BRAND.sub, opacity: saving ? 0.6 : 1 }}
                            >
                              Clear
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

                          {useRow === key && (
                            <UseStockForm
                              brand={BRAND}
                              max={b.total}
                              jobs={jobs}
                              saving={saving}
                              onCancel={() => setUseRow(null)}
                              onSubmit={async (patch) => {
                                const ok = await submit({
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
                                        : "Manual"}
                                  {e.jobId ? ` · ${e.jobId}` : ""}
                                  {e.note ? ` · ${e.note}` : ""}
                                  <div>
                                    {e.loggedBy} · {fmtStamp(e.loggedAt)}
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

        {section === "preorders" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
              <div style={{ flex: 1 }} />
              <button
                onClick={() => setShowPreOrder((v) => !v)}
                style={{
                  border: `1px solid ${BRAND.green}`,
                  background: BRAND.green,
                  color: "#fff",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                }}
              >
                + Pre-order material
              </button>
            </div>

            {showPreOrder && (
              <PreOrderForm
                brand={BRAND}
                saving={preOrderSaving}
                onCancel={() => setShowPreOrder(false)}
                onSubmit={async (entry) => {
                  const ok = await addPreOrder(entry);
                  if (ok) setShowPreOrder(false);
                }}
              />
            )}

            {activePreOrders.length === 0 ? (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                Nothing pre-ordered right now.
              </p>
            ) : (
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
                      <th style={th}>CRM</th>
                      <th style={th}>Project</th>
                      <th style={th}>Size</th>
                      <th style={{ ...th, textAlign: "right" }}>Qty</th>
                      <th style={th}>Material</th>
                      <th style={th}>Supplier</th>
                      <th style={th}>Expected</th>
                      <th style={th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activePreOrders.map((po) => {
                      const matched = jobById.get(String(po.crm).trim().toLowerCase()) || null;
                      const busy = pending[`preorder:${po.id}`];
                      const state = effectiveState(po);
                      const done = state === "completed";
                      return (
                        <Fragment key={po.id}>
                        <tr>
                          <td style={td}>
                            {matched ? (
                              <a
                                href={`${HANDOVER_APP}/${encodeURIComponent(po.crm)}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                              >
                                {po.crm}
                              </a>
                            ) : (
                              <span style={{ fontWeight: 600, fontStyle: "italic", color: BRAND.sub }} title="No handover for this CRM yet">
                                {po.crm}
                              </span>
                            )}
                            {matched && (
                              <span style={{ marginLeft: 6 }}>
                                <StageBadge handover={matched} />
                              </span>
                            )}
                          </td>
                          <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>
                            {matched ? matched.project || matched.client || "—" : po.project || "—"}
                          </td>
                          <td style={td}>{size(po)}</td>
                          <td style={{ ...td, textAlign: "right", whiteSpace: "normal" }}>
                            {po.quantity || "—"}
                            {/* Claimed by a job off its picking list. Worth
                                seeing before it lands, because it decides how
                                much of this delivery is actually hers. */}
                            {po.reserved > 0 && (
                              <div style={{ fontSize: 11, color: BRAND.blue }}>
                                {po.reserved} reserved · {po.reservedBy.map((r) => r.jobId).join(", ")}
                              </div>
                            )}
                          </td>
                          <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>{po.name || "—"}</td>
                          <td style={{ ...td, color: BRAND.sub }}>{po.supplier || "—"}</td>
                          <td style={td}>
                            <input
                              type="date"
                              value={po.expectedDate || ""}
                              onChange={(e) => setPreOrder(po.id, { expectedDate: e.target.value })}
                              style={{
                                border: `1px solid ${BRAND.line}`,
                                borderRadius: 6,
                                padding: "2px 6px",
                                fontSize: 12,
                                fontFamily: "inherit",
                              }}
                            />
                          </td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <span style={{ display: "inline-flex", gap: 6 }}>
                              {state === "to_order" && (
                                <button
                                  onClick={() => setPreOrder(po.id, { state: "ordered" })}
                                  disabled={busy}
                                  style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                                >
                                  Ordered
                                </button>
                              )}
                              {state === "ordered" && (
                                <button
                                  onClick={() => preOrderArrived(po)}
                                  disabled={busy}
                                  title="Fills the jobs that claimed it, then puts the balance into stock"
                                  style={{
                                    ...btn,
                                    background: BRAND.green,
                                    borderColor: BRAND.green,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                >
                                  Arrived
                                </button>
                              )}
                              {done && (
                                <span style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}>✓ Delivered</span>
                              )}
                            </span>
                            <span style={{ marginLeft: 8, display: "inline-flex", gap: 6 }}>
                              <button
                                onClick={() => movePreOrderToStock(po.id)}
                                disabled={busy}
                                title="The CRM never turned into a job — keep the material as general stock"
                                style={{ ...btn, color: BRAND.blue, opacity: busy ? 0.6 : 1 }}
                              >
                                Move to stock
                              </button>
                              <button
                                onClick={() => setPreOrder(po.id, { state: "cancelled" })}
                                disabled={busy}
                                title="Cancel this pre-order entirely"
                                style={{ ...btn, color: BRAND.sub, opacity: busy ? 0.6 : 1 }}
                              >
                                Cancel
                              </button>
                              <button
                                onClick={() => {
                                  setDeleteId(deleteId === po.id ? null : po.id);
                                  setDeleteText("");
                                }}
                                disabled={busy}
                                title="Erase this pre-order entirely — for a mis-entry, not just not needing it anymore"
                                style={{ ...btn, color: BRAND.red, opacity: busy ? 0.6 : 1 }}
                              >
                                Delete
                              </button>
                            </span>
                          </td>
                        </tr>
                        {deleteId === po.id && (
                          <tr>
                            <td colSpan={8} style={{ ...td, background: BRAND.bg }}>
                              <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                                <span style={{ color: BRAND.red }}>
                                  Type <strong>delete</strong> to permanently erase this pre-order:
                                </span>
                                <input
                                  autoFocus
                                  value={deleteText}
                                  onChange={(e) => setDeleteText(e.target.value)}
                                  style={{
                                    border: `1px solid ${BRAND.line}`,
                                    borderRadius: 6,
                                    padding: "3px 8px",
                                    fontSize: 12,
                                    fontFamily: "inherit",
                                    width: 100,
                                  }}
                                />
                                <button
                                  onClick={() => deletePreOrder(po.id)}
                                  disabled={busy || deleteText.trim().toLowerCase() !== "delete"}
                                  style={{
                                    ...btn,
                                    background: BRAND.red,
                                    borderColor: BRAND.red,
                                    color: "#fff",
                                    opacity: busy || deleteText.trim().toLowerCase() !== "delete" ? 0.5 : 1,
                                  }}
                                >
                                  {busy ? "Deleting…" : "Confirm delete"}
                                </button>
                                <button
                                  onClick={() => {
                                    setDeleteId(null);
                                    setDeleteText("");
                                  }}
                                  style={{ ...btn, background: BRAND.card }}
                                >
                                  Cancel
                                </button>
                              </span>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
      </div>
    </main>
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
function PickOne({ value, onChange, options, label, style }) {
  const inList = options.includes(value);
  const [custom, setCustom] = useState(Boolean(value) && !inList);

  if (custom) {
    return (
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <input
          style={style}
          value={value}
          placeholder={label}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          title={`Back to the ${label.toLowerCase()} list`}
          onClick={() => {
            setCustom(false);
            onChange("");
          }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#6b6862" }}
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <select
      style={style}
      value={value}
      onChange={(e) => {
        if (e.target.value === "__other__") {
          setCustom(true);
          onChange("");
          return;
        }
        onChange(e.target.value);
      }}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__other__">Other…</option>
    </select>
  );
}

function AddStockForm({ brand, onSubmit, onCancel, saving, options }) {
  // Two halves rather than one free-text name, the same as the handover's
  // picking list. If Alice types "Tas Oak" while Mitch picks "Smartlook
  // Tasmanian Oak", the register holds material his job can't find.
  const [finish, setFinish] = useState("");
  const [substrate, setSubstrate] = useState("");
  const name = materialNameOf(finish, substrate);
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");

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

function UseStockForm({ brand, max, jobs, onSubmit, onCancel, saving }) {
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
// handover with that CRM is logged, this line finds it on its own.
function PreOrderForm({ brand, onSubmit, onCancel, saving }) {
  const [crm, setCrm] = useState("");
  const [project, setProject] = useState("");
  const [name, setName] = useState("");
  const [length, setLength] = useState("");
  const [width, setWidth] = useState("");
  const [thickness, setThickness] = useState("");
  const [quantity, setQuantity] = useState("");
  const [supplier, setSupplier] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [note, setNote] = useState("");

  const input = {
    border: `1px solid ${brand.line}`,
    borderRadius: 6,
    padding: "6px 8px",
    fontSize: 13,
    fontFamily: "inherit",
    width: "100%",
    boxSizing: "border-box",
  };

  const valid = crm.trim() && name.trim();

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
      <div style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>CRM</label>
          <input style={input} value={crm} onChange={(e) => setCrm(e.target.value)} placeholder="e.g. 20488-1" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Project (optional)</label>
          <input style={input} value={project} onChange={(e) => setProject(e.target.value)} placeholder="Until there's a handover to name it" />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Supplier</label>
          <input style={input} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px 70px", gap: 8, marginBottom: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Material</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blackbutt NTV" />
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
          <input style={input} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 8, marginBottom: 12 }}>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Expected (optional)</label>
          <input type="date" style={input} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: brand.sub }}>Note (optional)</label>
          <input style={input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          disabled={!valid || saving}
          onClick={() =>
            onSubmit({
              crm: crm.trim(),
              project: project.trim(),
              name: name.trim(),
              length,
              width,
              thickness,
              quantity,
              supplier: supplier.trim(),
              expectedDate,
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
            opacity: !valid || saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save pre-order"}
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
