"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SubTabs from "../SubTabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import { confirmAndDeleteJob, deleteLinkStyle } from "../deleteJob.js";
import { JobStateBadge } from "../../lib/jobState.js";
// The same two helpers Veronica's own board uses, so a figure reads the same
// on both screens rather than being worked out twice.
import { orderTotal as shelfTotal, money } from "../../lib/shelfOrders.js";
import { PAGE_WIDTH, HEADER_HEIGHT, HEADER_GAP } from "../../lib/layout.js";
import { refreshLoop } from "../../lib/refresh.js";

// Invoicing board.
//
// Every handed-over job with what it's charged on — the figure Mitch entered at
// handover, per m² or per sheet. Veronica marks each one charged and it moves
// to the charged folder, the same way Alice works her material orders.
//
// Read-only on the figure itself: that's Mitch's, and if it's wrong the fix is
// on the handover, not here.
//
// To charge is ordered by whether the work is actually finished. A job still
// on the saw and a job sitting on the despatch dock are both "not charged
// yet", but only one of them is hers to act on, and the list used to read the
// same either way.

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

// Two tabs, because there are two states: owed, and done. Stock a client
// bought with no job behind it is a charge like any other — it was on a tab of
// its own, which meant looking in two places to answer "what's left to bill".
const VIEWS = [
  { key: "to_charge", label: "To charge" },
  { key: "charged", label: "Charged" },
];

function fmtTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" });
}

function fmtStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// A line only counts as priced once it has an amount — one entered without a
// basis is still shown (Mitch may not have decided m²-vs-sheet yet), just
// without a unit label.
function lineLabel(line) {
  const priced = line.amount !== "" && line.amount != null;
  const unit =
    line.basis === "sheet"
      ? "sheets"
      : line.basis === "m2"
        ? "m²"
        : line.basis === "pack"
          ? "packs"
          : "";
  return { priced, text: priced ? `${line.amount}${unit ? ` ${unit}` : ""}` : "not priced" };
}

export default function InvoicingPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [view, setView] = useState("to_charge");
  const [user, setUser] = useState(null);
  // Whether this person may charge a job, as opposed to look at what's owed.
  const caps = useCapabilities(user);
  const canEdit = caps.invoicing;
  const [pending, setPending] = useState({});
  const [stored, setStored] = useState({});
  const [shelf, setShelf] = useState([]);
  const [saving, setSaving] = useState(false);
  /**
   * Whether the hidden rows are being shown.
   *
   * A hide with nowhere to see what was hidden is a trapdoor: the row is
   * gone, nothing says so, and the only way back is Firestore. One line at
   * the end of the list, only there when something is behind it.
   */
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  /**
   * Charged for, which closes an off-the-shelf order on her side.
   *
   * The last thing that happens to one: the dock packed it, Alice sent it,
   * and this is the record that it was paid for. It stays on the tab
   * afterwards — the record is the reason the tab exists.
   */
  const chargeShelf = useCallback(
    async (order) => {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/shelf-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "contact",
            id: order.id,
            kind: "note",
            mark: "invoiced",
            note: "Charged",
            idToken,
          }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "Save failed");
        setShelf((list) => list.map((o) => (o.id === order.id ? { ...o, ...json.order } : o)));
      } catch (e) {
        setActionError(`Couldn't mark that charged. ${String(e.message || e)}`);
      } finally {
        setSaving(false);
      }
    },
    []
  );

  /**
   * Take an off-the-shelf order off the boards, keeping the record.
   *
   * This is where a wrong one gets noticed: a charged order is finished with,
   * so it never comes up anywhere else again, and a test row typed in to see
   * what the screen looked like sits in the Charged list for ever reading as
   * money somebody was invoiced for.
   *
   * Hidden rather than deleted, deliberately. Everything here has a figure on
   * it, and deleting something with a price to tidy a screen is how a record
   * nobody can reconstruct goes missing. Nothing about what was charged is
   * destroyed — it just stops being in the way, and `Hidden` below brings it
   * back.
   */
  const hideShelf = useCallback(async (order, hidden) => {
    const current = firebaseConfigured() ? auth().currentUser : null;
    if (!current) {
      setActionError("Sign in first — this is recorded against your name.");
      return;
    }
    setSaving(true);
    setActionError(null);
    try {
      const idToken = await current.getIdToken();
      const res = await fetch("/api/shelf-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: order.id, hidden, idToken }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Save failed");
      setShelf((list) => list.map((o) => (o.id === order.id ? { ...o, ...json.order } : o)));
    } catch (e) {
      setActionError(`Couldn't ${hidden ? "hide" : "restore"} that order. ${String(e.message || e)}`);
    } finally {
      setSaving(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/handovers", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load handovers");
      setData(json);
      setError(null);
      // The jobs are what this page is for; an off-the-shelf list that can't
      // be reached shouldn't take them down with it.
      try {
        const shelfRes = await fetch("/api/shelf-orders", { cache: "no-store" });
        const shelfJson = await shelfRes.json();
        if (shelfJson.ok) setShelf(shelfJson.orders || []);
      } catch {
        setShelf([]);
      }
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return refreshLoop(load, REFRESH_MS);
  }, [load]);

  const invoiceOf = (h) => stored[h.jobId] ?? h.invoice ?? { state: "to_charge" };
  const stateOf = (h) => invoiceOf(h).state || "to_charge";
  /**
   * Put away on this board, record intact.
   *
   * Read through `invoiceOf` like the state is, so a row that was just hidden
   * reads from the response rather than waiting for the next refresh.
   */
  const hiddenOf = (h) => Boolean(invoiceOf(h).hiddenAt);

  /**
   * This job was cut into loads after it was invoiced, and nobody has said
   * they have recorded it yet.
   *
   * Read through `invoiceOf` like the state is, so a row she has just
   * accepted moves off this list straight away rather than at the next
   * refresh.
   *
   * A job in this state IS charged — the money went out once, under one
   * reference, and splitting it afterwards did not unbill it. It appears on
   * To charge anyway, because this is the list she works from and a notice
   * on the Charged list is a notice nobody reads. It is drawn as a notice
   * rather than as a job, and there is no Mark charged on it.
   */
  const noticeOf = (h) => invoiceOf(h).splitAfterCharge ?? null;
  const noticePending = (h) => {
    const n = noticeOf(h);
    return Boolean(n && !n.acknowledgedAt);
  };

  /**
   * `jobId` here is the row's id, which for a split job is 21398-1-2 — a
   * despatch, not a document. The write has to name the handover and the
   * despatch separately, and `stored` stays keyed by the row so the board
   * updates the line that was clicked.
   */
  const setInvoice = useCallback(async (jobId, patch, { realJobId = jobId, partId = "" } = {}) => {
    if (!canEdit) {
      setActionError("This board is Veronica's — you can see it, but not change it.");
      return;
    }
    let idToken = null;
    if (patch.state === "charged") {
      const current = firebaseConfigured() ? auth().currentUser : null;
      if (!current) {
        setActionError("Sign in first so this is recorded against your name.");
        return;
      }
      idToken = await current.getIdToken();
    } else if (firebaseConfigured() && auth().currentUser) {
      idToken = await auth().currentUser.getIdToken();
    }

    setPending((p) => ({ ...p, [jobId]: true }));
    setActionError(null);
    try {
      const res = await fetch("/api/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: realJobId, partId, idToken, ...patch }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Update failed");
      setStored((s) => ({ ...s, [jobId]: json.invoice }));
    } catch (e) {
      setActionError(`Couldn't update ${jobId}. ${String(e.message || e)}`);
    } finally {
      setPending((p) => ({ ...p, [jobId]: false }));
    }
  }, [canEdit]);

  const deleteJob = async (row) => {
    const result = await confirmAndDeleteJob(row);
    if (result.cancelled) return;
    if (result.error) {
      setActionError(result.error);
      return;
    }
    setActionError(null);
    setData((d) =>
      d
        ? {
            ...d,
            awaiting: (d.awaiting || []).filter((h) => h.jobId !== row.jobId),
            scheduled: (d.scheduled || []).filter((h) => h.jobId !== row.jobId),
          }
        : d
    );
  };

  /**
   * Handovers somebody sent that haven't been released for charging.
   *
   * Off the board rather than greyed out, for the same reason Alice's works
   * that way: a row Veronica can read is a row she can charge, and an invoice
   * reaches a client whether or not the screen meant her to raise it. The
   * count is shown under the heading so a job stuck in a review queue is
   * visible from the board waiting for it — see /review.
   */
  /**
   * A job that goes out in more than one load is more than one invoice.
   *
   * Duncan could not fit it on one truck, so the handover was split — see
   * the Split despatch button on the handover. Each load is its own row here,
   * numbered 21398-1-1 and 21398-1-2, with its own share of the charge and
   * its own charged stamp. The job itself does not appear: billing it as a
   * whole would bill a load that has not left the building.
   *
   * Expanded here rather than on the server so every other board sees the
   * job exactly as it always did. Nothing about the split reaches Alice: the
   * picking list and the purchase orders are the job's, and they stay the
   * job's.
   */
  const expand = (rows) =>
    rows.flatMap((h) => {
      const parts = h.despatch ?? [];
      if (!parts.length) return [h];
      /**
       * One exception to "the job itself does not appear".
       *
       * A job that was cut into loads AFTER it was invoiced carries a notice
       * on the JOB's invoice — one invoice covering several deliveries is a
       * fact about the job, not about any one load, and saying it once per
       * load would be the same sentence three times.
       *
       * So the job keeps a row of its own for as long as the notice does.
       * While it is waiting it sits on To charge, tinted, offering nothing
       * but "Got it". Once she records it the same row moves to Charged and
       * stays there as the record — the same way a charged job stays on
       * that tab rather than disappearing, which is the reason she asked
       * for that tab in the first place.
       */
      const notice = h.invoice?.splitAfterCharge;
      const jobRow = notice
        ? [{ ...h, isSplitNotice: true, invoiceLines: [], invoiceDrift: [] }]
        : [];
      return [
        ...jobRow,
        ...parts.map((part, i) => ({
            ...h,
            jobId: part.jobId,
            partOf: h.jobId,
            partId: part.id,
            /**
             * Which load of how many, so the row can say it the way Duncan's
             * board does. "despatch of 21398-1" said this was one of some
             * unstated number — which leaves "is that the lot?" unanswerable
             * from the row, and that is the question behind every invoice.
             */
            partOrder: i + 1,
            partTotal: parts.length,
            /**
             * A load carrying more of a line than was ordered for the job.
             *
             * Acknowledged during the split, where somebody said the extra
             * would be pre-ordered from Alice or found on the rack. It
             * belongs here because it is a difference between what the job
             * was sold as and what this truck carried, which is a difference
             * in what gets billed.
             */
            shortfall: part.shortfall ?? null,
            /**
             * This load's dates and this load's state, not the job's.
             *
             * The job's schedule on a split one is the roll-up — blank until
             * every load has a date, and the LAST truck's date once they do
             * — so every row here read 18 December for a job whose loads go
             * on the 4th, the 16th and the 18th, and all four said "awaiting
             * schedule" while three of them were dated. Veronica bills a
             * load when it goes, so the date on the row has to be the date
             * that load goes.
             */
            schedule: part.schedule,
            fcSchedule: part.fcSchedule,
            jobSchedule: part.jobSchedule,
            state: part.state ?? h.state,
            invoice: part.invoice,
            invoiceLines: part.invoiceLines,
            invoiceDrift: part.invoiceDrift,
            chargeNote: part.note || h.chargeNote,
            // Veronica bills when the load goes, so the despatch date is the
            // date this row is waiting on — not the job's. The date the
            // Split panel recorded wins, since that is somebody saying when
            // this truck goes; otherwise it is what Duncan has dated it.
            despatchedAt:
              part.despatchDate ||
              part.jobSchedule?.actualDate ||
              part.jobSchedule?.committedDate ||
              null,
        })),
      ];
    });

  const everything = expand([...(data?.awaiting ?? []), ...(data?.scheduled ?? [])]);
  const heldForReview = everything.filter((h) => h.review && !h.review.invoice);
  const all = everything.filter((h) => !(h.review && !h.review.invoice));
  const q = query.trim().toLowerCase();
  const matching = q
    ? all.filter((h) =>
        [h.jobId, h.partOf, h.project, h.client, h.product]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      )
    : all;

  /**
   * Put away, record intact — see `hideShelf`.
   *
   * Taken out before anything is counted, so the tab's number agrees with
   * what is under it. A count that includes rows you cannot see is worse
   * than no count.
   */
  const shelfLive = shelf.filter((o) => !o.hiddenAt);
  const shelfHidden = shelf.filter((o) => o.hiddenAt);

  // Sent over by Veronica and not yet charged for. Charged ones stay on the
  // tab as the record — which is the reason she asked for it.
  const shelfToCharge = shelfLive.filter((o) => o.releasedAt && !o.invoicedAt);
  const shelfCharged = shelfLive.filter((o) => o.invoicedAt);
  /**
   * Which list a job is on.
   *
   * Normally its invoice state, and for one case not: a charged job with a
   * split notice nobody has accepted sits on To charge until she does, then
   * goes back where it belongs. The money never moves either way.
   */
  const tabOf = (h) => (noticePending(h) ? "to_charge" : stateOf(h));
  const counts = {
    to_charge: matching.filter((h) => tabOf(h) === "to_charge").length + shelfToCharge.length,
    charged:
      matching.filter((h) => tabOf(h) === "charged" && !hiddenOf(h)).length + shelfCharged.length,
  };
  // Whichever kind of charge this tab is about. Hidden rows join the charged
  // list only while somebody has asked to see them.
  const shelfOnTab = view === "charged" ? shelfCharged : shelfToCharge;
  const shelfHere =
    view === "charged" && showHidden ? [...shelfCharged, ...shelfHidden] : shelfOnTab;
  // Jobs put away on this board, kept out of the list and the count. Shown
  // only while somebody has asked to see them — same line as the shelf ones.
  const jobsHidden = matching.filter((h) => tabOf(h) === "charged" && hiddenOf(h));
  // What is really on this tab, for the header — hidden rows are left out
  // even while they are being shown, so it agrees with the tab above it.
  const jobsOnTab = matching.filter((h) => tabOf(h) === view && !hiddenOf(h));
  const jobs = matching
    .filter((h) => tabOf(h) === view && (showHidden || !hiddenOf(h)))
    // Out the door and uncharged first: that's the work waiting on her.
    // Within each group, oldest despatch first — the longest unbilled.
    .sort((a, b) => {
      const ready = (h) => (h.state === "despatched" ? 0 : 1);
      if (ready(a) !== ready(b)) return ready(a) - ready(b);
      // The job's two lines resolved into one, and a load's own — not the
      // first line's, and on a split job not the whole job's roll-up.
      return String(a.jobSchedule?.completedAt || "").localeCompare(
        String(b.jobSchedule?.completedAt || "")
      );
    });
  // The nudge: finished work nobody has invoiced. Not "everything unbilled",
  // which includes jobs that haven't been made yet and is just noise.
  const readyToCharge = matching.filter((h) => h.state === "despatched").length;
  // No billable line at all, or every billable line still has no amount.
  const missingFigure = jobs.filter((h) => {
    // A split notice has no lines because it is not a charge — counting it
    // here would nudge her to enter a figure on something already billed.
    if (h.isSplitNotice) return false;
    const lines = h.invoiceLines ?? [];
    return lines.length === 0 || lines.every((l) => !lineLabel(l).priced);
  }).length;

  const btn = {
    border: `1px solid ${BRAND.line}`,
    background: BRAND.card,
    color: BRAND.ink,
    borderRadius: 8,
    padding: "5px 12px",
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
      {/* Wide enough for the table this page exists for. It was capped at
          1000px like a page of prose, which meant a horizontal scrollbar
          on a screen with 900px of empty margin either side. */}
      <div style={{ maxWidth: PAGE_WIDTH, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: HEADER_GAP,
            minHeight: HEADER_HEIGHT,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
              Invoicing
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              {/* Everything on this tab, not just the jobs — it read "0 jobs"
                  over an off-the-shelf order sitting right underneath it.

                  Hidden rows are left out even while they are being shown, so
                  this agrees with the tab above it. A row somebody has put
                  away is not a charge waiting on anybody, and a header that
                  said 97 over a tab that said 96 is how a count stops being
                  believed. */}
              {jobsOnTab.length + shelfOnTab.length}{" "}
              {jobsOnTab.length + shelfOnTab.length === 1 ? "charge" : "charges"}
              {shelfOnTab.length > 0 && jobsOnTab.length > 0 && (
                <span style={{ color: BRAND.sub }}> · {shelfOnTab.length} off the shelf</span>
              )}
              {view === "to_charge" && readyToCharge > 0 && (
                <>
                  {" · "}
                  <strong style={{ color: BRAND.amber }}>
                    {readyToCharge} despatched and waiting
                  </strong>
                </>
              )}
              {missingFigure > 0 &&
                view === "to_charge" &&
                ` · ${missingFigure} with no figure entered yet`}
            </p>
            {/* A job held for review is a job that isn't on this board yet.
                Said out loud, so one sitting in somebody's queue is visible
                from here rather than simply missing. */}
            {heldForReview.length > 0 && (
              <p style={{ fontSize: 12.5, color: BRAND.amber, margin: "4px 0 0" }}>
                {heldForReview.length}{" "}
                {heldForReview.length === 1 ? "handover is" : "handovers are"} waiting to be
                released for charging — {heldForReview.map((h) => h.jobId).join(", ")}
              </p>
            )}
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
          current="invoicing" counts={{ invoicing: readyToCharge }} />

        <SubTabs
          items={VIEWS.map((v) => ({ ...v, count: counts[v.key] }))}
          current={view}
          onChange={setView}
        />

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
          placeholder="Filter by CRM, project or product"
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

        {/* Stock with no job behind it. Its own list, because none of the
            machinery below applies to it — no handover, no lines, no m2, just
            a customer, a product and a figure. */}
        {shelfHere.length > 0 && (
          <>
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: BRAND.sub,
                margin: "0 0 6px",
              }}
            >
              Off the shelf — no job behind it
            </div>
            <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
              {shelfHere.map((order) => {
                const charged = Boolean(order.invoicedAt);
                const hidden = Boolean(order.hiddenAt);
                return (
                  <section
                    key={order.id}
                    style={{
                      background: BRAND.card,
                      border: `1px ${hidden ? "dashed" : "solid"} ${
                        charged ? BRAND.line : BRAND.amber
                      }`,
                      borderRadius: 10,
                      padding: "12px 14px",
                      display: "flex",
                      gap: 14,
                      alignItems: "center",
                      flexWrap: "wrap",
                      opacity: hidden ? 0.5 : charged ? 0.75 : 1,
                    }}
                  >
                    <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{order.customer}</div>
                      <div style={{ fontSize: 13, color: BRAND.sub }}>
                        {order.product}
                        {order.qty ? ` · ${order.qty}` : ""}
                      </div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, minWidth: 90 }}>
                      {money(shelfTotal(order))}
                    </div>
                    <div style={{ fontSize: 12, color: BRAND.sub, minWidth: 150 }}>
                      {charged ? (
                        <>
                          Charged{" "}
                          {new Date(order.invoicedAt).toLocaleDateString("en-AU", {
                            day: "numeric",
                            month: "short",
                          })}
                          {order.invoicedBy && <div>{order.invoicedBy.split("@")[0]}</div>}
                          {hidden && (
                            <div style={{ fontStyle: "italic" }}>
                              Hidden{order.hiddenBy ? ` by ${order.hiddenBy.split("@")[0]}` : ""}
                            </div>
                          )}
                        </>
                      ) : order.dispatchedAt ? (
                        "Sent — waiting to be charged"
                      ) : order.packedAt ? (
                        "Packed, not yet sent"
                      ) : (
                        "With the warehouse"
                      )}
                    </div>
                    {!charged && (
                      <button
                        onClick={() => chargeShelf(order)}
                        disabled={saving || !canEdit}
                        title="Charged for — closes it off and keeps the record"
                        style={{
                          ...btn,
                          background: canEdit ? BRAND.green : BRAND.card,
                          borderColor: canEdit ? BRAND.green : BRAND.line,
                          color: canEdit ? "#fff" : BRAND.sub,
                          opacity: saving ? 0.6 : 1,
                        }}
                      >
                        Charged
                      </button>
                    )}
                    {/* Hiding follows being finished with, the same rule the
                        job rows above follow for Delete: a charged order is
                        over, so this is the only place a wrong one still
                        turns up. No confirm — nothing is destroyed, and the
                        line under the list puts it back. */}
                    {charged &&
                      canEdit &&
                      (order.hiddenAt ? (
                        <button
                          onClick={() => hideShelf(order, false)}
                          disabled={saving}
                          title="Put it back on the board"
                          style={{ ...btn, opacity: saving ? 0.6 : 1 }}
                        >
                          Unhide
                        </button>
                      ) : (
                        <button
                          onClick={() => hideShelf(order, true)}
                          disabled={saving}
                          title={`Take ${order.customer}'s order off the boards — the record is kept`}
                          style={deleteLinkStyle}
                        >
                          Hide
                        </button>
                      ))}
                  </section>
                );
              })}
            </div>
          </>
        )}

        {/*
          The way back.

          A hide with nowhere to see what was hidden is a trapdoor: the row is
          gone, nothing on the screen says so, and the only way to find it
          again is Firestore. One line, only there when something is behind
          it, and it says how many.
        */}
        {view === "charged" && shelfHidden.length + jobsHidden.length > 0 && (
          <p style={{ fontSize: 12, color: BRAND.sub, margin: "0 0 16px" }}>
            {shelfHidden.length + jobsHidden.length}{" "}
            {shelfHidden.length + jobsHidden.length === 1 ? "charge is" : "charges are"} hidden ·{" "}
            <button
              onClick={() => setShowHidden((v) => !v)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: BRAND.blue,
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 12,
              }}
            >
              {showHidden ? "hide them again" : "show them"}
            </button>
          </p>
        )}

        {!loading && jobs.length === 0 && shelfHere.length === 0 && (
          <p style={{ fontSize: 13, color: BRAND.sub }}>
            {all.length === 0
              ? "Nothing handed over yet."
              : view === "to_charge"
                ? "Everything's been charged."
                : "Nothing charged yet."}
          </p>
        )}

        {/* The jobs, under whatever off-the-shelf orders came first: those are
            a line each and a click, where a job is a card with figures to
            check. */}
        {jobs.length > 0 && shelfHere.length > 0 && (
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: BRAND.sub,
              margin: "0 0 6px",
            }}
          >
            Jobs
          </div>
        )}

        <div style={{ display: "grid", gap: 10 }}>
          {jobs.map((h) => {
            const invoice = invoiceOf(h);
            const lines = h.invoiceLines ?? [];
            const anyPriced = lines.some((l) => lineLabel(l).priced);
            const busy = pending[h.jobId];
            const notice = noticeOf(h);
            const pendingNotice = noticePending(h);
            return (
              <section
                key={h.jobId}
                style={{
                  // A notice is tinted all over rather than only edged, so
                  // it does not read as one more job to bill on a list of
                  // jobs to bill. It is the only row here that is not work.
                  background: pendingNotice ? "#fdf4e3" : BRAND.card,
                  // Dashed and faded while it is one of the hidden ones being
                  // shown, so it never reads as ordinary work on the list.
                  border: `1px ${invoice.hiddenAt ? "dashed" : "solid"} ${
                    pendingNotice ? BRAND.amber : BRAND.line
                  }`,
                  borderLeft: `3px solid ${
                    pendingNotice
                      ? BRAND.amber
                      : invoice.state === "charged"
                        ? BRAND.green
                        : anyPriced
                          ? BRAND.amber
                          : BRAND.line
                  }`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  opacity: invoice.hiddenAt ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  {/* The number Veronica puts on the invoice. For a split
                      job that is the despatch, 21398-1-2 — but the record
                      behind it is the handover, so the link goes there. */}
                  <a
                    href={`${HANDOVER_APP}/${encodeURIComponent(h.partOf || h.jobId)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 600, fontSize: 14, color: BRAND.blue, textDecoration: "none" }}
                  >
                    {h.jobId}
                  </a>
                  {h.partOf && (
                    <span
                      style={{
                        fontSize: 10,
                        color: BRAND.sub,
                        border: `1px solid ${BRAND.line}`,
                        borderRadius: 4,
                        padding: "1px 4px",
                        whiteSpace: "nowrap",
                      }}
                      title={`Load ${h.partOrder} of ${h.partTotal} on ${h.partOf}, which was split because it would not go on one truck. Each load is billed as it goes. The material order is the job's and is not split with it.`}
                    >
                      split {h.partOrder} of {h.partTotal} · {h.partOf}
                    </span>
                  )}
                  {/*
                    More on this truck than was ordered for the job.

                    Somebody acknowledged it during the split — the extra
                    comes from a pre-order to Alice or off the rack — and it
                    is on this row because it is a difference between what
                    the job was sold as and what this load carried, which is
                    a difference in what gets billed.
                  */}
                  {h.shortfall && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "#92400e",
                        border: "1px solid #fcd34d",
                        background: "#fffbeb",
                        borderRadius: 4,
                        padding: "1px 4px",
                        whiteSpace: "nowrap",
                      }}
                      title={`${(h.shortfall.lines || [])
                        .map(
                          (s) =>
                            `${s.short}${s.unit === "m2" ? " m²" : s.unit ? ` ${s.unit}` : ""} more ${
                              s.code || s.name
                            } than the job was sold`
                        )
                        .join(", ")} — acknowledged by ${String(h.shortfall.by || "").split("@")[0]}. Check it against what this load is being billed for.`}
                    >
                      carries more than ordered
                    </span>
                  )}
                  <span style={{ fontSize: 14 }}>{h.project || h.client || "—"}</span>
                  {h.client && h.project && (
                    <span style={{ fontSize: 12, color: BRAND.sub }}>{h.client}</span>
                  )}
                  {/* Where the job actually is. "Not charged yet" says nothing
                      about whether it's been made — this does. */}
                  <JobStateBadge
                    state={h.state}
                    title={
                      h.state === "despatched"
                        ? "Out the door and waiting on an invoice"
                        : "Where this job has got to"
                    }
                  />

                  <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                    {/* A job on this list only because it was split after it
                        was invoiced. It is charged and stays charged — so
                        the one thing it must NOT offer is Mark charged.
                        Accepting the notice is the whole of the action, and
                        the row moves to Charged where it belongs. */}
                    {h.isSplitNotice && !pendingNotice ? (
                      <span
                        style={{ fontSize: 12, color: BRAND.sub }}
                        title={`Recorded by ${notice?.acknowledgedBy || "somebody"}`}
                      >
                        ✓ Split recorded
                      </span>
                    ) : pendingNotice ? (
                      <button
                        onClick={() => setInvoice(h.jobId, { acknowledgeSplit: true }, { realJobId: h.partOf || h.jobId })}
                        disabled={busy}
                        style={{
                          ...btn,
                          background: BRAND.amber,
                          borderColor: BRAND.amber,
                          color: "#fff",
                          opacity: busy ? 0.6 : 1,
                        }}
                        title="I have seen this and recorded it against the invoice"
                      >
                        Got it — recorded
                      </button>
                    ) : invoice.state === "to_charge" ? (
                      <button
                        onClick={() => setInvoice(h.jobId, { state: "charged" }, { realJobId: h.partOf || h.jobId, partId: h.partId || "" })}
                        disabled={busy}
                        style={{
                          ...btn,
                          background: BRAND.green,
                          borderColor: BRAND.green,
                          color: "#fff",
                          opacity: busy ? 0.6 : 1,
                        }}
                      >
                        Charged
                      </button>
                    ) : (
                      <button
                        onClick={() => setInvoice(h.jobId, { state: "to_charge" }, { realJobId: h.partOf || h.jobId, partId: h.partId || "" })}
                        disabled={busy}
                        style={{ ...btn, color: BRAND.green }}
                        title={
                          invoice.chargedBy
                            ? `Charged by ${invoice.chargedBy}`
                            : "Charged"
                        }
                      >
                        ✓ Charged
                      </button>
                    )}
                    {/* Deleting follows completion, not charging: the schedule
                        owns when a job is over. Read through `jobSchedule`,
                        which is both lines resolved into one — a job whose
                        fibre cement half is still on the saw is not over,
                        and `schedule` alone would have said it was. */}
                    {invoice.state === "charged" && h.jobSchedule?.completedAt && (
                      <button
                        onClick={() => deleteJob(h)}
                        title="Remove this job and its record completely"
                        style={deleteLinkStyle}
                      >
                        Delete
                      </button>
                    )}
                    {/*
                      Off this board, record intact.

                      Charged is the gate, not despatched. Delete above is
                      gated on the job having actually gone out, because it
                      takes the handover off every board at once — which left
                      a job that never got that far with no way off this list
                      at all, and a test handover is exactly that job. 001
                      "Test, ignore me" has been sitting on it.

                      This only changes what Veronica sees. The handover is
                      untouched and is still whatever it is to Duncan.
                    */}
                    {invoice.state === "charged" &&
                      (invoice.hiddenAt ? (
                        <button
                          onClick={() => setInvoice(h.jobId, { hidden: false }, { realJobId: h.partOf || h.jobId, partId: h.partId || "" })}
                          disabled={busy}
                          title="Put it back on this board"
                          style={{ ...btn, opacity: busy ? 0.6 : 1 }}
                        >
                          Unhide
                        </button>
                      ) : (
                        <button
                          onClick={() => setInvoice(h.jobId, { hidden: true }, { realJobId: h.partOf || h.jobId, partId: h.partId || "" })}
                          disabled={busy}
                          title={`Take ${h.jobId} off the invoicing board — the handover is untouched`}
                          style={deleteLinkStyle}
                        >
                          Hide
                        </button>
                      ))}
                  </span>
                </div>

                <div style={{ marginTop: 10, fontSize: 13 }}>
                  {/* A notice row carries no lines BECAUSE it is a notice —
                      the loads below it carry them. Saying "nothing entered"
                      would read as a job somebody forgot to fill in. */}
                  {h.isSplitNotice ? null : lines.length === 0 ? (
                    <span style={{ color: BRAND.amber }}>No products or materials entered yet.</span>
                  ) : (
                    <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
                      <tbody>
                        {lines.map((l) => {
                          const label = lineLabel(l);
                          return (
                            <tr key={l.id}>
                              <td style={{ padding: "2px 10px 2px 0", color: BRAND.sub, fontFamily: "'SF Mono', ui-monospace, monospace", fontSize: 12 }}>
                                {l.code || "—"}
                              </td>
                              <td style={{ padding: "2px 10px 2px 0" }}>
                                {l.name || "—"}
                                {/* Not on the sales invoice in front of her —
                                    this one has to be raised as a variation,
                                    and nothing else on the line would say so.
                                    Most often the packs: how many packs of
                                    screws a job took isn't known until it's
                                    been drawn, long after it was priced. */}
                                {l.kind === "additional" && (
                                  <span
                                    title="Additional item — not on the original sales invoice"
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      letterSpacing: "0.03em",
                                      color: BRAND.amber,
                                      border: `1px solid ${BRAND.amber}`,
                                      borderRadius: 4,
                                      padding: "0 4px",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    ADDITIONAL
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "2px 10px 2px 0", color: BRAND.sub }}>
                                {l.quantity !== "" && l.quantity != null ? `× ${l.quantity}` : ""}
                              </td>
                              <td style={{ padding: "2px 10px 2px 0" }}>
                                {label.priced ? (
                                  <strong>{label.text}</strong>
                                ) : (
                                  <span style={{ color: BRAND.amber }}>{label.text}</span>
                                )}
                              </td>
                              <td style={{ padding: "2px 0", color: BRAND.red, fontWeight: 500 }}>
                                {l.note || ""}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 20,
                    flexWrap: "wrap",
                    marginTop: 8,
                    fontSize: 13,
                  }}
                >
                  {h.charge?.note && <Fact label="Note">{h.charge.note}</Fact>}
                  {/*
                    When this row goes out, which is when it gets billed.

                    `jobSchedule` and not `schedule`: a job on both of
                    Duncan's lines keeps its second line's dates in
                    `fcSchedule`, so reading `schedule` showed the MDF half
                    and said nothing about the fibre cement half — and the
                    job is not out the door until both have gone. On a load
                    it is that load's own answer. See the logged route.

                    A load whose despatch was recorded in the Split panel
                    uses that, because somebody said in so many words when
                    that truck goes.
                  */}
                  <Fact label="Despatch">
                    {h.despatchedAt ||
                      h.jobSchedule?.actualDate ||
                      h.jobSchedule?.committedDate ||
                      "—"}
                  </Fact>
                </div>

                {invoice.state === "charged" && (
                  <p style={{ fontSize: 12, color: BRAND.sub, margin: "10px 0 0" }}>
                    Charged by {invoice.chargedBy || "unknown"}
                    {invoice.chargedAt ? ` · ${fmtStamp(invoice.chargedAt)}` : ""}
                    {invoice.reference ? ` · ref ${invoice.reference}` : ""}
                  </p>
                )}

                {/* The job has moved since the invoice went out.
                    Not an error — correcting a handover after charging is a
                    legitimate thing to do — but it is a variation somebody
                    has to decide about, and the whole point of recording
                    what was billed is that this is visible rather than
                    absorbed into a recomputed figure nobody notices. */}
                {invoice.state === "charged" && (h.invoiceDrift ?? []).length > 0 && (
                  <div
                    style={{
                      marginTop: 10,
                      border: `1px solid ${BRAND.amber}`,
                      background: "#fdf4e3",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <strong style={{ fontSize: 12, color: BRAND.amber }}>
                      The job has changed since this was invoiced
                    </strong>
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: BRAND.ink }}>
                      {h.invoiceDrift.slice(0, 6).map((row, i) => (
                        <li key={i}>
                          {row.kind === "added"
                            ? `${row.name} — added since, not on the invoice`
                            : row.kind === "removed"
                              ? `${row.name} — billed, no longer on the job`
                              : `${row.name} — ${row.field} was ${row.was}, now ${row.now}`}
                        </li>
                      ))}
                    </ul>
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: BRAND.sub }}>
                      Invoice {invoice.reference || "(no reference)"} says what was billed. Raise a
                      variation or a credit if the difference is real.
                    </p>
                  </div>
                )}

                {/* The job was cut into loads after it was invoiced.
                    Every load inherits the charge, so nothing comes back
                    here as work to do and nothing can be billed twice —
                    which is exactly why it has to be said out loud. One
                    invoice now covers more than one delivery, and how that
                    gets recorded is Veronica's call, not the system's. */}
                {notice && (
                  <div
                    style={{
                      marginTop: 10,
                      border: `1px solid ${BRAND.amber}`,
                      background: "#fdf4e3",
                      borderRadius: 8,
                      padding: "8px 10px",
                    }}
                  >
                    <strong style={{ fontSize: 12, color: BRAND.amber }}>
                      Split into {notice.loads} load
                      {notice.loads === 1 ? "" : "s"} after it was invoiced
                    </strong>
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: BRAND.ink }}>
                      {notice.reference
                        ? `Invoice ${notice.reference} covers all of them.`
                        : "One invoice covers all of them."}{" "}
                      Nothing has been re-charged and no load is waiting to be billed — this is
                      here so you can record the split against the invoice however you need to.
                    </p>
                    <p style={{ margin: "6px 0 0", fontSize: 11, color: BRAND.sub }}>
                      Split by {(notice.by || "").split("@")[0] || "somebody"} on{" "}
                      {String(notice.at || "").slice(0, 10)}.
                      {notice.acknowledgedAt
                        ? ` Recorded by ${
                            (notice.acknowledgedBy || "").split("@")[0] || "somebody"
                          } on ${String(notice.acknowledgedAt).slice(0, 10)}.`
                        : ""}
                    </p>
                  </div>
                )}

                <div style={{ marginTop: 10 }}>
                  <input
                    defaultValue={invoice.reference || ""}
                    onBlur={(e) => {
                      if ((invoice.reference || "") !== e.target.value) {
                        setInvoice(h.jobId, { reference: e.target.value }, { realJobId: h.partOf || h.jobId, partId: h.partId || "" });
                      }
                    }}
                    placeholder="Invoice reference (optional)"
                    style={{
                      border: `1px solid ${BRAND.line}`,
                      borderRadius: 6,
                      padding: "4px 8px",
                      fontSize: 12,
                      fontFamily: "inherit",
                      width: 240,
                    }}
                  />
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b6862" }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
