"use client";

import { useCallback, useEffect, useState, Fragment } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import PreOrderForm from "../PreOrderForm.js";
import LineEditor from "../LineEditor.js";
import { splitMaterialName } from "../../lib/materialGroups.js";

// Material orders board.
//
// Alice works line by line, not job by job: one job can need three materials
// from three suppliers landing weeks apart. Each line moves to order → ordered
// → completed and carries the date she expects it, which is what Duncan
// schedules against. A job is only "in" when every line is.
//
// Purely procurement status — ordered it, delivered it? Where a material
// physically is (stock, what stage a job's at) lives on the Stock page.
//
// Pre-orders sit in the same list. Jordan or Duncan flag material for a job
// that hasn't been handed over yet, and until now that only showed on the
// Stock page — so the thing most needing Alice's attention was the thing she
// had to go looking for. They're tinted and badged so she can tell at a
// glance that there's no handover behind them, and otherwise they behave like
// any other line: order it, put the PO on, book it in.

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

const REFRESH_MS = 15 * 60 * 1000;
const HANDOVER_APP = "https://decorhandover.lyphex.com";

const VIEWS = [
  // The three stages of buying something, then the list of what hasn't been
  // asked for yet. A line leaves Outstanding the moment Alice orders it, so
  // what's left in front of her is only what she still has to do.
  { key: "outstanding", label: "Outstanding" },
  { key: "ordered", label: "Ordered" },
  { key: "complete", label: "All in — completed orders" },
  // Last, because it's the start of the list's life rather than a stage of
  // it: raised here, and from that moment it's sitting in Outstanding with
  // everything else waiting to be ordered.
  { key: "preorders", label: "Pre-orders" },
];

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function fmtDay(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Stock skips ordering but still gets confirmed — "we have stock" at handover
// isn't the same as someone having looked on the floor.
//
// The handover app works the state out the same way and sends it down, so this
// only stands in for a row that predates the field.
function effectiveState(m) {
  return m.state || "to_order";
}

/**
 * How many a quantity means. "2 Rolls", "37 + 3 Spare" — every number counts,
 * matching the rule the handover app uses, so 200 of 300 means the same thing
 * on both screens.
 */
function countOf(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const found = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  return found ? found.reduce((sum, n) => sum + Number(n), 0) : 0;
}

/**
 * How many to buy: what the nest needs plus whatever spare was asked for.
 *
 * The handover app works this out and sends it down; the fallback is for a
 * record that predates spare existing, where the quantity was the whole story.
 */
function orderQty(m) {
  return m.orderQty != null ? countOf(m.orderQty) : countOf(m.quantity) + countOf(m.spare);
}

/** "200 of 300 in · 100 to come", for a line that arrived in more than one drop. */
function receivedLabel(m) {
  const had = countOf(m.receivedQty);
  const want = orderQty(m);
  if (!had) return "";
  return want > had ? `${had} of ${want} in · ${want - had} to come` : `${had} in`;
}

function size(m) {
  if (!m.length || !m.width) return "—";
  return `${m.length} × ${m.width}${m.thickness ? ` × ${m.thickness}` : ""}`;
}

/**
 * The two halves of what a line is made of.
 *
 * Both a handover material and a pre-order now carry the finish and the
 * substrate as separate fields, because Alice orders them separately. Older
 * records only have the joined name, so it gets pulled back apart the same way
 * the stock register does it.
 */
function halves(m) {
  if (m.finish || m.substrate) return { finish: m.finish || "", substrate: m.substrate || "" };
  return splitMaterialName(m.name || "");
}

/**
 * The same board, however it was typed. Finish, substrate and thickness — not
 * the sheet size, because two sizes of the same board go on one order as two
 * lines, and that is exactly the order worth combining.
 */
function batchKey(m) {
  const { finish, substrate } = halves(m);
  return [finish, substrate, m.thickness ?? ""]
    .map((x) => String(x).trim().toLowerCase())
    .join("|");
}

/** One key for both kinds of row, since they share every piece of state. */
function keyOf(m) {
  return m.isPreOrder ? `pre:${m.id}` : `${m.jobId}:${m.id}`;
}

export default function MaterialsPage() {
  const [data, setData] = useState(null);
  const [preOrders, setPreOrders] = useState([]);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("outstanding");
  const [user, setUser] = useState(null);
  // Whether this person may change anything here, as opposed to read it.
  const caps = useCapabilities(user);
  const canEdit = caps.materials;
  // What's been typed into a Received box but not saved yet, keyed by line.
  // The box was uncontrolled before, which meant a re-render could quietly
  // put the old number back under her cursor.
  const [received, setReceived] = useState({});
  // Same idea for the PO number: typed here, read out the back when the truck
  // arrives, so it's the one thing tying a docket to a job.
  const [po, setPo] = useState({});
  const [pending, setPending] = useState({});
  const [showPreOrder, setShowPreOrder] = useState(false);
  const [preOrderSaving, setPreOrderSaving] = useState(false);
  // Which pre-order is open for correcting, if any.
  const [editId, setEditId] = useState(null);
  // Which line on the ordering board is open for correcting — either kind.
  const [editLine, setEditLine] = useState(null);
  const [lineSaving, setLineSaving] = useState(false);
  // Which pre-order has its delete-confirm row open, and what's typed in it.
  const [deleteId, setDeleteId] = useState(null);
  const [deleteText, setDeleteText] = useState("");
  // What the server stored, adopted after each write so what's on screen is
  // its answer rather than our guess.
  const [stored, setStored] = useState({});

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Both lists, together, so Refresh means the whole board. A pre-order
      // failing to load shouldn't hide the jobs — the handovers are the part
      // that must be right.
      const [res, preRes] = await Promise.all([
        fetch("/api/handovers", { cache: "no-store" }),
        fetch("/api/pre-orders", { cache: "no-store" }).catch(() => null),
      ]);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load handovers");
      setData(json);
      setError(null);
      const preJson = preRes ? await preRes.json().catch(() => null) : null;
      if (preJson?.ok) setPreOrders(preJson.preOrders || []);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const linesFor = (h) => stored[h.jobId] ?? h.materials ?? [];

  const setLine = useCallback(async (jobId, lineId, patch) => {
    if (!canEdit) {
      setActionError("This board is Alice's — you can see it, but not change it.");
      return;
    }
    // Claiming a line is ordered or in needs a name against it. Clearing one
    // back to "to order" only withdraws a claim.
    let idToken = null;
    const claiming = patch.state === "ordered" || patch.state === "completed";
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

    const key = `${jobId}:${lineId}`;
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/material-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, lineId, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setStored((s) => ({ ...s, [jobId]: json.materials }));
    } catch (e) {
      setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, [canEdit]);

  // Same moves on a pre-order: order it, date it, put the PO on. The record
  // lives in its own collection rather than inside a handover, because the
  // job it's for may not have been written yet — so it's a different endpoint,
  // not a different way of working.
  const setPreOrder = useCallback(async (id, patch) => {
    if (!canEdit) {
      setActionError("This board is Alice's — you can see it, but not change it.");
      return;
    }
    const current = firebaseConfigured() ? auth().currentUser : null;
    const claiming =
      patch.state === "ordered" || patch.state === "completed" || patch.state === "cancelled";
    if (claiming && !current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const idToken = current ? await current.getIdToken() : null;

    const key = `pre:${id}`;
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/pre-orders/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setPreOrders((prev) => prev.map((p) => (p.id === id ? { ...p, ...json.preOrder } : p)));
    } catch (e) {
      setActionError(`Couldn't update that pre-order. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, [canEdit]);

  /**
   * A pre-order landing.
   *
   * Not the same as closing a job's line: jobs may have claimed some of it off
   * their picking lists since it was raised, so those claims are filled first
   * and the balance becomes stock. That arithmetic is the handover app's, done
   * in one batch — all this does is say how many turned up.
   */
  const preOrderArrived = useCallback(async (po, arrived) => {
    if (!canEdit) {
      setActionError("This board is Alice's — you can see it, but not change it.");
      return;
    }
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const key = `pre:${po.id}`;
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/arrive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: po.id, arrived: String(arrived ?? "").trim(), idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      // Jobs, stock and the pre-order all moved at once, so reload rather than
      // patching three lists and hoping they agree.
      load();
      const parts = [];
      if (json.allocations?.length) {
        parts.push(
          `${json.allocations.reduce((s, a) => s + a.allocated, 0)} to ${[
            ...new Set(json.allocations.map((a) => a.jobId)),
          ].join(", ")}`
        );
      }
      if (json.toStock > 0) parts.push(`${json.toStock} into stock`);
      // The order stays open for the rest, so say so rather than letting a
      // part delivery look like a finished one.
      if (json.stillToCome > 0) parts.push(`${json.stillToCome} still to come from the supplier`);
      if (json.short > 0) parts.push(`${json.short} short — those job lines stay outstanding`);
      if (parts.length) setActionError(`Booked in: ${parts.join(" · ")}.`);
    } catch (e) {
      setActionError(`Couldn't record that arrival. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, [canEdit, load]);

  // Raising one. Jordan or Duncan know a job's coming — a quote, a heads-up
  // from drafting — and the lead time should start now rather than when Mitch
  // gets round to writing the handover.
  const addPreOrder = useCallback(async (entries) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return false;
    }
    setPreOrderSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      // A job needing three materials is three pre-orders: each is ordered,
      // arrives and gets claimed on its own. The form asks once; this writes
      // one record per line, in the order they were typed.
      const saved = [];
      for (const entry of entries) {
        const res = await fetch("/api/pre-orders/add", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...entry, idToken }),
        });
        const json = await res.json();
        if (!json.ok) {
          // Whatever got in stays in — the rest is still on screen to retry.
          if (saved.length) setPreOrders((prev) => [...saved.reverse(), ...prev]);
          throw new Error(
            saved.length
              ? `${saved.length} saved, then "${entry.finish}" failed: ${json.error || "save failed"}`
              : json.error || "Save failed"
          );
        }
        saved.push(json.preOrder);
      }
      setPreOrders((prev) => [...saved.reverse(), ...prev]);
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setPreOrderSaving(false);
    }
  }, []);

  /**
   * Putting a pre-order right.
   *
   * Jordan raises one off a quote and the finish or the count often isn't
   * settled yet, so it stays his to correct until Alice buys it. After that
   * the server refuses: the record is then what a supplier has been asked for.
   * The stamp lives on the pre-order itself — the material order downstream
   * just reads the new numbers, since what it needs to know is what to buy.
   */
  const updatePreOrder = useCallback(async (id, entry) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so the change is recorded against your name.");
      return false;
    }
    setPreOrderSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/pre-orders/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, idToken, ...entry }),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(
          json.error === "already_ordered"
            ? "It's been ordered — the details are what the supplier was asked for now, so they can't be changed here."
            : json.error || "Save failed"
        );
      }
      setPreOrders((prev) => prev.map((p) => (p.id === id ? { ...p, ...json.preOrder } : p)));
      return true;
    } catch (e) {
      setActionError(String(e.message || e));
      return false;
    } finally {
      setPreOrderSaving(false);
    }
  }, []);

  // The CRM never turned into a job — the material's still coming, it just
  // isn't earmarked anymore, so it becomes ordinary stock rather than sitting
  // here waiting for a handover that will never be written.
  const movePreOrderToStock = useCallback(async (id) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const key = `pre:${id}`;
    setPending((p) => ({ ...p, [key]: true }));
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
    } catch (e) {
      setActionError(`Couldn't move that pre-order to stock. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, []);

  // Genuinely erases it — for a mis-entry, not for "we don't need this
  // anymore", which is Cancel and keeps the record.
  const deletePreOrder = useCallback(async (id) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so this is recorded against your name.");
      return;
    }
    const key = `pre:${id}`;
    setPending((p) => ({ ...p, [key]: true }));
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
      setPending((p) => ({ ...p, [key]: false }));
    }
  }, []);

  /**
   * Correcting what a line is for, from the board it's ordered from.
   *
   * The two kinds are stored in different places — a picking-list line lives
   * inside its handover, a pre-order in its own record — but they describe the
   * same thing, so one form feeds both and the endpoint is the only
   * difference. Both refuse once the line has been ordered.
   */
  const saveLine = useCallback(async (row, patch) => {
    if (!canEdit) {
      setActionError("This board is Alice's — you can see it, but not change it.");
      return;
    }
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first so the change is recorded against your name.");
      return;
    }
    setLineSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch(
        row.isPreOrder ? "/api/pre-orders/update" : "/api/material-line",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            row.isPreOrder
              ? { id: row.id, idToken, ...patch }
              : { jobId: row.jobId, lineId: row.id, idToken, ...patch }
          ),
        }
      );
      const json = await res.json();
      if (!json.ok) {
        throw new Error(
          json.error === "already_ordered"
            ? "It's been ordered — the line is what the supplier was asked for now."
            : json.error || "Save failed"
        );
      }
      if (row.isPreOrder) {
        setPreOrders((prev) => prev.map((p) => (p.id === row.id ? { ...p, ...json.preOrder } : p)));
      } else {
        setStored((st) => ({ ...st, [row.jobId]: json.materials }));
      }
      setEditLine(null);
    } catch (e) {
      setActionError(String(e.message || e));
    } finally {
      setLineSaving(false);
    }
  }, [canEdit]);

  // One call for either kind of row, so the cells below don't each have to
  // know which they're rendering.
  const patchRow = useCallback(
    (row, patch) => (row.isPreOrder ? setPreOrder(row.id, patch) : setLine(row.jobId, row.id, patch)),
    [setPreOrder, setLine]
  );

  const all = [...(data?.awaiting ?? []), ...(data?.scheduled ?? [])];
  const q = query.trim().toLowerCase();
  // Searched on the halves as well as the joined name: "Show the 3" on a
  // shared board filters by the finish, and a line whose name was typed some
  // other way would drop out of its own batch.
  const matching = q
    ? all.filter((h) =>
        [
          h.jobId,
          h.project,
          h.client,
          ...(h.materials || []).flatMap((m) => [m.name, m.finish, m.substrate]),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : all;

  // Flattened to one row per material line — Alice works line by line, not
  // job by job, so the list reads like the schedule board's rows rather than
  // a stack of per-job cards.
  const jobLines = matching.flatMap((h) =>
    linesFor(h).map((m) => ({
      ...m,
      jobId: h.jobId,
      project: h.project || h.client || "",
      fibreCement: h.fibreCement,
    }))
  );

  // Pre-orders, as rows of the same list, and as the Pre-orders tab's own
  // list. Cancelled ones and ones already folded into general stock are
  // finished with — the record stays, but there's nothing left to do.
  const preOrderLines = preOrders
    .filter((p) => p.state !== "cancelled" && p.state !== "moved_to_stock")
    .filter(
      (p) =>
        !q ||
        [p.crm, p.project, p.name, p.finish, p.substrate, p.supplier, p.poNumber, p.note]
          .join(" ")
          .toLowerCase()
          .includes(q)
    )
    .map((p) => ({
      ...p,
      isPreOrder: true,
      // The CRM is typed by hand and may not be a job yet, which is the whole
      // point of a pre-order — so it reads as the job number but doesn't
      // promise there's a handover behind it.
      jobId: p.crm,
      hasHandover: all.some((h) => h.jobId === p.crm),
      project: p.project || "",
      state: p.state || "to_order",
    }));

  // Pre-orders first: they're the ones with nothing behind them yet, so
  // they're the ones that get forgotten.
  const allLines = [...preOrderLines, ...jobLines];
  /**
   * Which list a line belongs in — the three stages of buying something.
   *
   * Outstanding is work for Alice: nothing has been ordered yet. Ordered is
   * work for the supplier and then the dock: it's bought, and what's left is
   * waiting for it. A part delivery stays in Ordered, because some of it is
   * still on a truck somewhere.
   */
  const bucketOf = (m) => {
    const state = effectiveState(m);
    if (state === "completed") return "complete";
    if (state === "ordered" || state === "part_received") return "ordered";
    return "outstanding";
  };
  const counts = {
    outstanding: allLines.filter((m) => bucketOf(m) === "outstanding").length,
    ordered: allLines.filter((m) => bucketOf(m) === "ordered").length,
    complete: allLines.filter((m) => bucketOf(m) === "complete").length,
    preorders: preOrderLines.length,
  };
  // The Pre-orders tab has a list of its own below, so the shared table stands
  // down for it.
  const inView = view === "preorders" ? [] : allLines.filter((m) => bucketOf(m) === view);

  // Kept together by job. A job needing three boards is three orders to place,
  // but it is still one job, and a row of it sitting on its own three rows down
  // reads like somebody else's. Order within the list is otherwise untouched.
  const lines = (() => {
    const byJob = new Map();
    for (const m of inView) {
      const key = String(m.jobId || "");
      if (!byJob.has(key)) byJob.set(key, []);
      byJob.get(key).push(m);
    }
    return [...byJob.values()].flat();
  })();

  /**
   * The same board wanted by more than one job.
   *
   * Two jobs each pre-ordering Smartlook Tasmanian Oak on CharCore are two
   * orders to two suppliers on two days, for one thing. Nothing in the record
   * says so — each line only knows its own job — so it's worked out here and
   * put in front of her while she can still act on it: anything not yet in,
   * whichever tab she's on.
   */
  const batches = (() => {
    const map = new Map();
    for (const m of allLines) {
      if (bucketOf(m) === "complete" || m.fromStock) continue;
      const key = batchKey(m);
      if (key.replace(/\|/g, "") === "") continue;
      const { finish, substrate } = halves(m);
      const group = map.get(key) ?? {
        key,
        finish,
        substrate,
        // What to type into the filter to see this group — a board is named
        // by its finish, but plenty are only a substrate: Versilux, FC sheet,
        // anything sold raw. Filtering on the finish alone searched for an
        // empty string and the button did nothing.
        term: finish || substrate,
        rows: [],
      };
      group.rows.push(m);
      map.set(key, group);
    }
    // Two lines of one job is just a job with two sizes on it. It takes two
    // jobs before there is anything to combine.
    return [...map.values()].filter(
      (g) => new Set(g.rows.map((r) => r.jobId)).size > 1
    );
  })();
  const batchFor = (m) => batches.find((g) => g.key === batchKey(m)) || null;


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
  // Dense, line-by-line rows — same feel as the schedule board rather than a
  // stack of per-job cards.
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
              Material orders
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {view === "preorders"
                ? "Material wanted for a job that hasn't been handed over yet"
                : `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${
                    view === "outstanding"
                      ? "order each one, then mark it Ordered"
                      : view === "ordered"
                        ? "waiting on the supplier — tick each one as it lands"
                        : "in, and nothing more to do"
                  }`}
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <div style={{ marginTop: 6 }}>
              {data?.fetchedAt ? `Updated ${fmtTime(data.fetchedAt)}` : ""}
            </div>
          </div>
        </header>

        <Tabs
          tabs={caps.tabs}
          current="materials"
          counts={{
            // Everything not yet in — what's still to buy and what's bought
            // but not arrived. The split between those two is Alice's
            // business; to everyone else it's one number: material the
            // factory is still waiting on.
            materials: counts.outstanding + counts.ordered,
            // Shown on every strip so finished-but-unbilled work reaches
            // Veronica wherever she is, rather than only once she looks.
            invoicing: all.filter((h) => h.state === "despatched").length,
          }}
        />

        <div style={{ display: "flex", gap: 18, marginBottom: 16, borderBottom: `1px solid ${BRAND.line}` }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setView(v.key)}
              style={{
                border: "none",
                borderBottom: `2px solid ${view === v.key ? BRAND.sub : "transparent"}`,
                background: "none",
                color: view === v.key ? BRAND.ink : "#9c988f",
                fontWeight: view === v.key ? 600 : 400,
                fontSize: 12,
                padding: "0 0 7px",
                marginBottom: -1,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {v.label} ({counts[v.key]})
            </button>
          ))}
        </div>

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
              border: "1px solid #a3312c",
              color: "#a3312c",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load handovers. {error}
          </div>
        )}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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

        {view === "preorders" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "baseline" }}>
              <p style={{ fontSize: 12, color: BRAND.sub, margin: 0, flex: 1 }}>
                Raised here, and from that moment it&apos;s sitting in Outstanding to be ordered like
                anything else. When it lands, whatever a job has claimed goes to that job and the
                rest onto the racks.
              </p>
              <button
                onClick={() => setShowPreOrder((v) => !v)}
                disabled={!canEdit}
                title={canEdit ? undefined : "You can see these, but not raise one."}
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
                  opacity: canEdit ? 1 : 0.5,
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
                onSubmit={async (entries) => {
                  const ok = await addPreOrder(entries);
                  if (ok) setShowPreOrder(false);
                }}
              />
            )}

            {preOrderLines.length === 0 ? (
              <p style={{ fontSize: 13, color: BRAND.sub }}>Nothing pre-ordered right now.</p>
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
                      <th style={th}>Finish</th>
                      <th style={th}>Substrate</th>
                      <th style={th}>Supplier</th>
                      <th style={th}>Status</th>
                      <th style={th}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preOrderLines.map((p) => {
                      const key = `pre:${p.id}`;
                      const busy = pending[key];
                      const state = effectiveState(p);
                      return (
                        <Fragment key={p.id}>
                          <tr>
                            <td style={td}>
                              {p.hasHandover ? (
                                <a
                                  href={`${HANDOVER_APP}/${encodeURIComponent(p.crm)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                                >
                                  {p.crm}
                                </a>
                              ) : (
                                <span
                                  style={{ fontWeight: 600, fontStyle: "italic", color: BRAND.sub }}
                                  title="No handover under this number yet — which is the point of a pre-order"
                                >
                                  {p.crm}
                                </span>
                              )}
                            </td>
                            <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>
                              {p.project || "—"}
                              {(p.loggedBy || p.note) && (
                                <div style={{ fontSize: 11, color: BRAND.sub }}>
                                  {p.loggedBy ? p.loggedBy.split("@")[0] : ""}
                                  {p.loggedBy && p.note ? " · " : ""}
                                  {p.note || ""}
                                </div>
                              )}
                              {/* Says the record isn't quite what was first
                                  written, and whose doing that was. */}
                              {p.editedAt && (
                                <div style={{ fontSize: 11, color: BRAND.amber }}>
                                  edited {fmtDay(p.editedAt)}
                                  {p.editedBy ? ` by ${p.editedBy.split("@")[0]}` : ""}
                                </div>
                              )}
                            </td>
                            <td style={td}>{size(p)}</td>
                            <td style={{ ...td, textAlign: "right", whiteSpace: "normal" }}>
                              {p.quantity || "—"}
                              {/* Claimed by a job off its picking list — worth
                                  seeing before it lands, because it decides how
                                  much of the delivery is actually spare. */}
                              {p.reserved > 0 && (
                                <div style={{ fontSize: 11, color: BRAND.blue }}>
                                  {p.reserved} claimed ·{" "}
                                  {[...new Set((p.reservedBy || []).map((r) => r.jobId))].join(", ")}
                                </div>
                              )}
                            </td>
                            <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>
                              {halves(p).finish || "—"}
                            </td>
                            <td style={{ ...td, whiteSpace: "normal", minWidth: 100, color: BRAND.sub }}>
                              {halves(p).substrate || "—"}
                            </td>
                            <td style={{ ...td, color: BRAND.sub }}>{p.supplier || "—"}</td>
                            <td style={td}>
                              {state === "completed" ? (
                                <span style={{ color: BRAND.green, fontWeight: 500 }}>✓ Arrived</span>
                              ) : state === "ordered" ? (
                                <span style={{ color: BRAND.amber }}>
                                  On order{p.poNumber ? ` · PO ${p.poNumber}` : ""}
                                  {/* A part delivery leaves it here, owing the
                                      rest — the number she's chasing. */}
                                  {countOf(p.receivedQty) > 0 && (
                                    <div style={{ fontSize: 11 }}>
                                      {receivedLabel(p)}
                                    </div>
                                  )}
                                </span>
                              ) : (
                                <span style={{ color: BRAND.sub }}>Waiting to be ordered</span>
                              )}
                            </td>
                            {/* Ordering and booking in happen in Outstanding,
                                with the rest of her work. What's left here is
                                what only a pre-order can need: it never became
                                a job, or it shouldn't have been typed. */}
                            <td style={{ ...td, textAlign: "right" }}>
                              <span style={{ display: "inline-flex", gap: 6 }}>
                                {/* Only until Alice buys it. After that the
                                    record is what a supplier was asked for,
                                    and the server says so too. */}
                                {state === "to_order" && (
                                  <button
                                    onClick={() => {
                                      setEditId(editId === p.id ? null : p.id);
                                      setDeleteId(null);
                                    }}
                                    disabled={busy || !canEdit}
                                    title="Put it right — the finish, the count, whatever's changed since"
                                    style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                                  >
                                    {editId === p.id ? "Close" : "Edit"}
                                  </button>
                                )}
                                {state !== "completed" && (
                                  <>
                                    <button
                                      onClick={() => movePreOrderToStock(p.id)}
                                      disabled={busy || !canEdit}
                                      title="The CRM never turned into a job — keep the material as general stock"
                                      style={{ ...btn, color: BRAND.blue, opacity: busy ? 0.6 : 1 }}
                                    >
                                      Move to stock
                                    </button>
                                    <button
                                      onClick={() => patchRow(p, { state: "cancelled" })}
                                      disabled={busy || !canEdit}
                                      title="Cancel this pre-order entirely — keeps the record"
                                      style={{ ...btn, color: BRAND.sub, opacity: busy ? 0.6 : 1 }}
                                    >
                                      Cancel
                                    </button>
                                  </>
                                )}
                                <button
                                  onClick={() => {
                                    setDeleteId(deleteId === p.id ? null : p.id);
                                    setDeleteText("");
                                  }}
                                  disabled={busy || !canEdit}
                                  title="Erase it — for a mis-entry, not for not needing it anymore"
                                  style={{ ...btn, color: BRAND.red, opacity: busy ? 0.6 : 1 }}
                                >
                                  Delete
                                </button>
                              </span>
                            </td>
                          </tr>
                          {editId === p.id && (
                            <tr>
                              <td colSpan={9} style={{ padding: 0, background: BRAND.bg }}>
                                <div style={{ padding: "12px 10px 0" }}>
                                  <PreOrderForm
                                    brand={BRAND}
                                    saving={preOrderSaving}
                                    initial={p}
                                    onCancel={() => setEditId(null)}
                                    onSubmit={async (entries) => {
                                      const ok = await updatePreOrder(p.id, entries[0]);
                                      if (ok) setEditId(null);
                                    }}
                                  />
                                </div>
                              </td>
                            </tr>
                          )}
                          {deleteId === p.id && (
                            <tr>
                              <td colSpan={9} style={{ ...td, background: BRAND.bg }}>
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
                                    onClick={() => deletePreOrder(p.id)}
                                    disabled={busy || deleteText.trim().toLowerCase() !== "delete"}
                                    style={{
                                      ...btn,
                                      background: BRAND.red,
                                      borderColor: BRAND.red,
                                      color: "#fff",
                                      opacity:
                                        busy || deleteText.trim().toLowerCase() !== "delete" ? 0.5 : 1,
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

        {!loading && view !== "preorders" && lines.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "outstanding"
                ? "Nothing left to order."
                : view === "ordered"
                  ? "Nothing on order — everything's either still to buy or already in."
                  : "Nothing fully in yet."}
          </p>
        )}

        {/* The same board, wanted by two jobs. Worth seeing before she places
            either order rather than after both have shipped. */}
        {view !== "preorders" && batches.length > 0 && (
          <div
            style={{
              background: "#fdf8ee",
              border: `1px solid ${BRAND.amber}`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            <strong style={{ color: BRAND.amber }}>
              {batches.length === 1 ? "One material is" : `${batches.length} materials are`} wanted by
              more than one job
            </strong>
            <span style={{ color: BRAND.sub }}> — could go on one order.</span>
            {batches.map((g) => (
              <div key={g.key} style={{ marginTop: 4 }}>
                {[g.finish, g.substrate].filter(Boolean).join(" on ")}:{" "}
                {[...new Set(g.rows.map((r) => r.jobId))].join(", ")}
                <button
                  onClick={() => setQuery(g.term)}
                  style={{
                    ...btn,
                    marginLeft: 8,
                    padding: "1px 8px",
                    fontSize: 11,
                  }}
                >
                  Show the {g.rows.length}
                </button>
              </div>
            ))}
          </div>
        )}

        {lines.length > 0 && (
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
                  <th style={th}>Job</th>
                  <th style={th}>Project</th>
                  <th style={th}>Size</th>
                  <th style={{ ...th, textAlign: "right" }}>Qty</th>
                  <th style={th}>Finish</th>
                  <th style={th}>Substrate</th>
                  <th style={th}>Supplier</th>
                  <th style={th}>PO</th>
                  <th style={th}>Expected</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((m, i) => {
                  const key = keyOf(m);
                  const busy = pending[key];
                  const state = effectiveState(m);
                  const done = state === "completed";
                  const pre = Boolean(m.isPreOrder);
                  // One job, several boards: said once and then left blank, so
                  // the eye reads it as a block rather than as three unrelated
                  // lines that happen to share a number.
                  const sameJobAbove = i > 0 && lines[i - 1].jobId === m.jobId;
                  const sameJobBelow = i + 1 < lines.length && lines[i + 1].jobId === m.jobId;
                  const batch = batchFor(m);
                  return (
                    // Two rows while the editor is open beneath it, so the row
                    // itself never changes shape.
                    <Fragment key={key}>
                    <tr
                      // Tinted, so a row with no handover behind it doesn't read
                      // as one that has.
                      style={pre ? { background: "#fdf8ee" } : undefined}
                    >
                      <td style={{ ...td, borderBottom: sameJobBelow ? "none" : td.borderBottom }}>
                        {sameJobAbove ? (
                          <span style={{ color: "#cfcac0" }} title={`Still ${m.jobId}`}>
                            ↳
                          </span>
                        ) : pre && !m.hasHandover ? (
                          <span style={{ fontWeight: 600 }} title="No handover logged under this number yet">
                            {m.jobId || "—"}
                          </span>
                        ) : (
                          <a
                            href={`${HANDOVER_APP}/${encodeURIComponent(m.jobId)}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: BRAND.blue, textDecoration: "none", fontWeight: 600 }}
                          >
                            {m.jobId}
                          </a>
                        )}
                        {pre && !sameJobAbove && (
                          <span
                            title={
                              m.hasHandover
                                ? `Pre-order — raised before the handover existed${m.loggedBy ? ` by ${m.loggedBy}` : ""}. The job is logged now.`
                                : `Pre-ordered${m.loggedBy ? ` by ${m.loggedBy}` : ""} — no handover under this number yet. Order it anyway; it's wanted.`
                            }
                            style={{
                              marginLeft: 5,
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: "0.03em",
                              color: BRAND.amber,
                              border: `1px solid ${BRAND.amber}`,
                              borderRadius: 4,
                              padding: "0 4px",
                            }}
                          >
                            PRE-ORDER
                          </span>
                        )}
                        {m.fibreCement && (
                          <span style={{ marginLeft: 5, fontSize: 10, color: BRAND.sub, border: `1px solid ${BRAND.line}`, borderRadius: 4, padding: "0 4px" }}>
                            FC
                          </span>
                        )}
                      </td>
                      <td
                        style={{
                          ...td,
                          whiteSpace: "normal",
                          minWidth: 140,
                          borderBottom: sameJobBelow ? "none" : td.borderBottom,
                        }}
                      >
                        {sameJobAbove ? "" : m.project || "—"}
                        {/* Who asked for it and why, since there's no handover
                            to open and read. */}
                        {pre && !sameJobAbove && (m.loggedBy || m.note) && (
                          <div style={{ fontSize: 11, color: BRAND.sub }}>
                            {m.loggedBy ? m.loggedBy.split("@")[0] : ""}
                            {m.loggedBy && m.note ? " · " : ""}
                            {m.note || ""}
                          </div>
                        )}
                        {pre && m.reserved > 0 && (
                          <div style={{ fontSize: 11, color: BRAND.amber }}>
                            {m.reserved} claimed by {[...new Set((m.reservedBy || []).map((r) => r.jobId))].join(", ")}
                          </div>
                        )}
                      </td>
                      <td style={td}>{size(m)}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "normal" }}>
                        {/* What to buy, not what the nest needs — they differ
                            whenever spare was asked for, and buying is what
                            this board is for. */}
                        {orderQty(m) || m.quantity || "—"}
                        {countOf(m.spare) > 0 && (
                          <div style={{ fontSize: 11, color: BRAND.sub }}>
                            {countOf(m.quantity)} + {countOf(m.spare)} spare
                          </div>
                        )}
                        {/* The short version of a part delivery, where the eye
                            lands rather than out in the status column. */}
                        {receivedLabel(m) && !done && (
                          <div style={{ fontSize: 11, color: BRAND.amber }}>
                            {receivedLabel(m)}
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "normal", minWidth: 140 }}>
                        {halves(m).finish || "—"}
                        {/* Another job wants this same board. Said on the line,
                            because this is where she decides what to order. */}
                        {batch && (
                          <button
                            onClick={() => setQuery(batch.term)}
                            title={`Also wanted by ${[...new Set(batch.rows.map((r) => r.jobId))]
                              .filter((id) => id !== m.jobId)
                              .join(", ")} — click to see them together`}
                            style={{
                              marginLeft: 6,
                              background: "none",
                              border: `1px solid ${BRAND.amber}`,
                              borderRadius: 4,
                              color: BRAND.amber,
                              cursor: "pointer",
                              fontSize: 10,
                              fontWeight: 600,
                              fontFamily: "inherit",
                              padding: "0 4px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {new Set(batch.rows.map((r) => r.jobId)).size} JOBS
                          </button>
                        )}
                      </td>
                      <td style={{ ...td, whiteSpace: "normal", minWidth: 100, color: BRAND.sub }}>
                        {halves(m).substrate || "—"}
                      </td>
                      <td style={{ ...td, color: BRAND.sub }}>{m.fromStock ? "Stock" : m.supplier || "—"}</td>
                      {/* The supplier's order number. Nothing in the job says
                          it, so it has to be typed once — here, where the order
                          is placed — and from then on it's what the warehouse
                          matches a delivery docket against. Stock never has
                          one: nothing was bought. */}
                      <td style={td}>
                        {m.fromStock ? (
                          <span style={{ color: BRAND.sub }}>—</span>
                        ) : (
                          (() => {
                            const saved = String(m.poNumber ?? "");
                            const draft = po[key] ?? saved;
                            const changed = draft.trim() !== saved.trim();
                            const clear = () =>
                              setPo((p) => {
                                const next = { ...p };
                                delete next[key];
                                return next;
                              });
                            const save = () => {
                              if (!changed) return clear();
                              patchRow(m, { poNumber: draft.trim() });
                              clear();
                            };
                            return (
                              <input
                                value={draft}
                                onChange={(e) => setPo((p) => ({ ...p, [key]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") save();
                                  if (e.key === "Escape") clear();
                                }}
                                onBlur={save}
                                disabled={busy || !canEdit}
                                placeholder="PO"
                                title="Purchase order number — what the warehouse will see on the docket"
                                aria-label={`PO number for ${m.name || m.jobId}`}
                                style={{
                                  width: 90,
                                  border: `1px solid ${changed ? BRAND.amber : BRAND.line}`,
                                  borderRadius: 6,
                                  padding: "2px 6px",
                                  fontSize: 12,
                                  fontFamily: "inherit",
                                }}
                              />
                            );
                          })()
                        )}
                      </td>
                      <td style={td}>
                        <input
                          type="date"
                          value={m.expectedDate || ""}
                          onChange={(e) => patchRow(m, { expectedDate: e.target.value })}
                          title={
                            m.fromStock
                              ? "Optional — set or update this even for stock, if there's any uncertainty on timing"
                              : undefined
                          }
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
                        {/* Correctable until it's ordered, and only until
                            then — after that the line is what a supplier was
                            asked for. Stock lines aren't being bought. */}
                        {state === "to_order" && !m.fromStock && canEdit && (
                          <button
                            onClick={() => setEditLine(editLine === key ? null : key)}
                            title="Put this line right — the board, the size, the count, the supplier"
                            style={{ ...btn, marginRight: 6 }}
                          >
                            {editLine === key ? "Close" : "Edit"}
                          </button>
                        )}
                        {pre ? (
                          /* A pre-order runs the same course — order it, then
                             book it in — but landing isn't just closing a line.
                             Any job that has claimed some of it off its picking
                             list gets filled first and the balance goes to
                             stock, which the handover app works out in one go.
                             So the last step is Arrived, not All in. */
                          done ? (
                            <span
                              style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}
                              title={
                                m.arrivedQty
                                  ? `${m.arrivedQty} arrived — split between the jobs that claimed it and stock`
                                  : "Arrived — split between the jobs that claimed it and stock"
                              }
                            >
                              ✓ Arrived
                            </span>
                          ) : state === "to_order" ? (
                            <button
                              onClick={() => patchRow(m, { state: "ordered" })}
                              disabled={busy || !canEdit}
                              title="Ordered with the supplier — same as any other line"
                              style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                            >
                              Ordered
                            </button>
                          ) : (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              {(() => {
                                const draft = received[key] ?? "";
                                // What's still owed, so the box defaults to the
                                // rest of a part-delivered order rather than to
                                // the whole of it a second time.
                                const owed = orderQty(m) - countOf(m.receivedQty);
                                return (
                                  <>
                                    <input
                                      type="number"
                                      min="0"
                                      placeholder={String(owed > 0 ? owed : m.quantity ?? "")}
                                      value={draft}
                                      onChange={(e) =>
                                        setReceived((r) => ({ ...r, [key]: e.target.value }))
                                      }
                                      disabled={busy || !canEdit}
                                      title="How many turned up. Leave it blank if the lot came."
                                      aria-label={`Arrived of ${m.quantity} for ${m.name}`}
                                      style={{
                                        width: 54,
                                        border: `1px solid ${draft ? BRAND.amber : BRAND.line}`,
                                        borderRadius: 6,
                                        padding: "2px 6px",
                                        fontSize: 12,
                                        fontFamily: "inherit",
                                      }}
                                    />
                                    <span style={{ fontSize: 11, color: BRAND.sub }}>
                                      of {m.quantity || "—"}
                                    </span>
                                    <button
                                      onClick={() => {
                                        preOrderArrived(m, draft);
                                        setReceived((r) => {
                                          const next = { ...r };
                                          delete next[key];
                                          return next;
                                        });
                                      }}
                                      disabled={busy || !canEdit}
                                      title="It's here — fills any job that claimed it, the rest goes to stock"
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
                                  </>
                                );
                              })()}
                              <button
                                onClick={() => patchRow(m, { state: "to_order" })}
                                disabled={busy || !canEdit}
                                style={{
                                  ...btn,
                                  background: BRAND.red,
                                  borderColor: BRAND.red,
                                  color: "#fff",
                                  opacity: busy ? 0.6 : 1,
                                }}
                                title="Back to to-order"
                              >
                                Undo
                              </button>
                            </span>
                          )
                        ) : m.fromStock ? (
                          done ? (
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <span
                                style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}
                                title={m.completedBy ? `Stock confirmed by ${m.completedBy}` : "Stock confirmed"}
                              >
                                ✓ In stock
                              </span>
                              <button
                                onClick={() => setLine(m.jobId, m.id, { state: "to_order" })}
                                disabled={busy}
                                style={{
                                  ...btn,
                                  background: BRAND.red,
                                  borderColor: BRAND.red,
                                  color: "#fff",
                                  opacity: busy ? 0.6 : 1,
                                }}
                              >
                                Undo
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => setLine(m.jobId, m.id, { state: "completed" })}
                              disabled={busy}
                              style={{
                                ...btn,
                                background: BRAND.green,
                                borderColor: BRAND.green,
                                color: "#fff",
                                opacity: busy ? 0.6 : 1,
                              }}
                            >
                              Confirm stock
                            </button>
                          )
                        ) : (
                          <span style={{ display: "inline-flex", gap: 6 }}>
                            {state === "to_order" && (
                              <button
                                onClick={() => setLine(m.jobId, m.id, { state: "ordered" })}
                                disabled={busy}
                                style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                              >
                                Ordered
                              </button>
                            )}
                            {(state === "ordered" || state === "part_received") && (
                              <>
                                {/* What's landed so far. A big order rarely
                                    arrives at once, and a line that can only be
                                    ordered or delivered can't say 200 of 300 —
                                    which is the thing Duncan needs to know. */}
                                {(() => {
                                  const stored = String(m.receivedQty ?? "");
                                  const draft = received[key] ?? stored;
                                  const changed = draft.trim() !== stored.trim();
                                  const save = () => {
                                    if (!changed) return;
                                    setLine(m.jobId, m.id, { receivedQty: draft.trim() });
                                    // Dropped so the box falls back to what
                                    // came back from the server, rather than
                                    // showing a draft that may not have saved.
                                    setReceived((r) => {
                                      const next = { ...r };
                                      delete next[key];
                                      return next;
                                    });
                                  };
                                  return (
                                    <span
                                      style={{ display: "inline-flex", gap: 4, alignItems: "center" }}
                                    >
                                      <input
                                        type="number"
                                        min="0"
                                        placeholder="0"
                                        value={draft}
                                        onChange={(e) =>
                                          setReceived((r) => ({ ...r, [key]: e.target.value }))
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") save();
                                          if (e.key === "Escape") {
                                            setReceived((r) => {
                                              const next = { ...r };
                                              delete next[key];
                                              return next;
                                            });
                                          }
                                        }}
                                        onBlur={save}
                                        disabled={busy}
                                        title="How many have landed. Set the Expected date to when the rest is due."
                                        aria-label={`Received of ${m.quantity}`}
                                        style={{
                                          width: 54,
                                          border: `1px solid ${changed ? BRAND.amber : BRAND.line}`,
                                          borderRadius: 6,
                                          padding: "2px 6px",
                                          fontSize: 12,
                                          fontFamily: "inherit",
                                        }}
                                      />
                                      <span style={{ fontSize: 11, color: BRAND.sub }}>
                                        of {orderQty(m) || m.quantity || "—"}
                                      </span>
                                      {/* An explicit way to commit it. Relying
                                          on the blur alone meant typing a
                                          number and navigating away lost it,
                                          with nothing on screen to say so. */}
                                      {changed && (
                                        <button
                                          onClick={save}
                                          disabled={busy}
                                          style={{
                                            ...btn,
                                            background: BRAND.amber,
                                            borderColor: BRAND.amber,
                                            color: "#fff",
                                            opacity: busy ? 0.6 : 1,
                                          }}
                                        >
                                          Save
                                        </button>
                                      )}
                                    </span>
                                  );
                                })()}
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "completed" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.green,
                                    borderColor: BRAND.green,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                  title="All in — closes the line whatever the count says"
                                >
                                  All in
                                </button>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "to_order", receivedQty: "" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.red,
                                    borderColor: BRAND.red,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                  title="Back to to-order"
                                >
                                  Undo
                                </button>
                              </>
                            )}
                            {done && (
                              <>
                                <span
                                  style={{ color: BRAND.green, fontSize: 12, fontWeight: 500 }}
                                  title={m.completedBy ? `Delivered — confirmed by ${m.completedBy}` : "Delivered"}
                                >
                                  ✓ Delivered
                                </span>
                                <button
                                  onClick={() => setLine(m.jobId, m.id, { state: "ordered" })}
                                  disabled={busy}
                                  style={{
                                    ...btn,
                                    background: BRAND.red,
                                    borderColor: BRAND.red,
                                    color: "#fff",
                                    opacity: busy ? 0.6 : 1,
                                  }}
                                >
                                  Undo
                                </button>
                              </>
                            )}
                          </span>
                        )}
                        {/* Who put it on order and when. It was in the record
                            all along; nobody could see it without opening the
                            handover. */}
                        {m.orderedAt && state !== "to_order" && (
                          <div style={{ fontSize: 11, color: BRAND.sub, marginTop: 2 }}>
                            ordered {fmtDay(m.orderedAt)}
                            {m.orderedBy ? ` · ${m.orderedBy.split("@")[0]}` : ""}
                          </div>
                        )}
                      </td>
                    </tr>
                    {editLine === key && (
                      <tr>
                        <td colSpan={10} style={{ ...td, background: "#faf9f6", whiteSpace: "normal" }}>
                          <LineEditor
                            brand={BRAND}
                            line={{ ...m, ...halves(m) }}
                            saving={lineSaving}
                            onCancel={() => setEditLine(null)}
                            onSave={(patch) => saveLine(m, patch)}
                          />
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
      </div>
    </main>
  );
}
