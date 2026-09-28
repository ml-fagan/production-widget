"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import Tabs from "../Tabs.js";
import SignIn from "../SignIn.js";
import { auth, firebaseConfigured } from "../../lib/firebaseClient.js";
import { useCapabilities } from "../../lib/useCapabilities.js";
import {
  CHASE_LEADS,
  BUCKETS,
  today,
  chaseDate,
  daysBetween,
  orderTotal,
  money,
  longDate,
  shortDate,
  bucketOf,
  chaseCount,
  lastContact,
  fillTemplate,
} from "../../lib/shelfOrders.js";

// Off the shelf — a client buying stock we already hold.
//
// No handover, no schedule, no job number: none of the machinery the rest of
// this system exists for. It has been living in a drafts folder and in
// Veronica's memory of who to ring.
//
// Two boards. One to take the order, which works out when to start chasing and
// fills both emails from what she typed. One to chase, grouped by what needs
// doing rather than sorted into a single list — "chase today" and "waiting on
// the money" are different jobs.

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
  padding: "5px 12px",
  fontSize: 12,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};
const miniBtn = { ...btn, padding: "2px 8px", fontSize: 11, borderRadius: 6 };
const input = {
  border: `1px solid ${BRAND.line}`,
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
  background: BRAND.card,
};
const th = {
  textAlign: "left",
  fontSize: 11,
  color: BRAND.sub,
  fontWeight: 500,
  padding: "7px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  whiteSpace: "nowrap",
};
const td = {
  fontSize: 12,
  padding: "7px 10px",
  borderBottom: `1px solid ${BRAND.line}`,
  verticalAlign: "top",
};

const SECTIONS = [
  { key: "new", label: "New order" },
  { key: "chase", label: "Chasing" },
];

const BLANK = {
  customer: "",
  product: "",
  qty: "",
  price: "",
  siteDate: "",
  chaseLeadDays: 14,
  note: "",
};

export default function ShelfOrdersPage() {
  const [section, setSection] = useState("new");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [user, setUser] = useState(null);
  const caps = useCapabilities(user);
  const canEdit = caps.invoicing;
  const [draft, setDraft] = useState(BLANK);
  // The order the email panels are showing: the one just taken, or one picked
  // off the chase board.
  const [showing, setShowing] = useState(null);
  const [editingTemplates, setEditingTemplates] = useState(false);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return onAuthStateChanged(auth(), setUser);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shelf-orders", { cache: "no-store" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load orders");
      setData(json);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }, []);

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
        setActionError("Sign in first — an order has a name against it.");
        return null;
      }
      setSaving(true);
      setActionError(null);
      try {
        const idToken = await current.getIdToken();
        const res = await fetch("/api/shelf-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, idToken }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || "That didn't save");
        await load();
        return json;
      } catch (e) {
        setActionError(String(e.message || e));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [load]
  );

  const orders = data?.orders ?? [];
  const templates = data?.templates ?? null;
  const now = today();

  // What the email panels are filled from: the order she's looking at, or the
  // one she's typing. Typing one fills the emails as she goes, which is the
  // point — she shouldn't have to save first to see what she'll be sending.
  const subject = useMemo(
    () => showing ?? { ...draft, price: Number(draft.price) || 0, contacts: [] },
    [showing, draft]
  );

  const grouped = useMemo(() => {
    const map = new Map(BUCKETS.map((b) => [b.key, []]));
    for (const order of orders) map.get(bucketOf(order, now))?.push(order);
    for (const list of map.values()) {
      list.sort((a, b) => String(chaseDate(a)).localeCompare(String(chaseDate(b))));
    }
    return map;
  }, [orders, now]);

  const chaseOn = chaseDate({ siteDate: draft.siteDate, chaseLeadDays: draft.chaseLeadDays });
  const outstanding = grouped.get("now")?.length ?? 0;

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setActionError("Couldn't reach the clipboard — select the text and copy it by hand.");
    }
  };

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
      <div style={{ maxWidth: 1400, margin: "0 auto" }}>
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
              Off the shelf
            </h1>
            <p style={{ fontSize: 13, color: BRAND.sub, margin: "2px 0 0" }}>
              Stock a client has ordered — no job behind it, just a date and an invoice
            </p>
          </div>
          <div style={{ textAlign: "right", fontSize: 12, color: BRAND.sub }}>
            <SignIn user={user} brand={BRAND} />
            <button onClick={load} style={{ ...btn, padding: "6px 12px", fontSize: 13 }}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        <Tabs
          current="shelforders"
          tabs={caps.tabs}
          counts={{ shelforders: outstanding }}
        />

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
              {s.key === "chase" && outstanding > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    background: "#f6dcd9",
                    color: BRAND.red,
                    borderRadius: 10,
                    padding: "1px 7px",
                  }}
                >
                  {outstanding}
                </span>
              )}
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
              border: `1px solid ${BRAND.red}`,
              color: BRAND.red,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 13,
              marginBottom: 16,
            }}
          >
            Couldn&apos;t load the orders. {error}
          </div>
        )}

        {section === "new" && (
          <>
            <div
              style={{
                background: BRAND.card,
                border: `1px solid ${BRAND.line}`,
                borderRadius: 10,
                padding: 16,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gap: 10,
                  gridTemplateColumns: "1.4fr 1.4fr 0.8fr 0.8fr 1fr 1fr",
                  alignItems: "end",
                }}
              >
                {[
                  { key: "customer", label: "Customer", placeholder: "Who it's for" },
                  { key: "product", label: "Product", placeholder: "What they've asked for" },
                  { key: "qty", label: "Quantity", placeholder: "40 sheets" },
                  { key: "price", label: "Price each", placeholder: "0.00", type: "number" },
                ].map((f) => (
                  <label key={f.key} style={{ fontSize: 11, color: BRAND.sub }}>
                    <div style={{ marginBottom: 3 }}>{f.label}</div>
                    <input
                      type={f.type || "text"}
                      value={draft[f.key]}
                      onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      style={input}
                    />
                  </label>
                ))}
                <label style={{ fontSize: 11, color: BRAND.sub }}>
                  <div style={{ marginBottom: 3 }}>Needed on site</div>
                  <input
                    type="date"
                    value={draft.siteDate}
                    onChange={(e) => setDraft({ ...draft, siteDate: e.target.value })}
                    style={input}
                  />
                </label>
                <label style={{ fontSize: 11, color: BRAND.sub }}>
                  <div style={{ marginBottom: 3 }}>Start chasing</div>
                  <select
                    value={draft.chaseLeadDays}
                    onChange={(e) => setDraft({ ...draft, chaseLeadDays: Number(e.target.value) })}
                    style={input}
                  >
                    {CHASE_LEADS.map((d) => (
                      <option key={d} value={d}>
                        {d} days before
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {/* The chase date as she types, rather than worked out on paper
                  after the fact. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 10,
                  marginTop: 12,
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: 13 }}>
                  {chaseOn ? (
                    <>
                      <strong style={{ fontWeight: 600 }}>{longDate(chaseOn)}</strong>
                      <span style={{ color: BRAND.sub }}>
                        {" "}
                        — {draft.chaseLeadDays} days before it&apos;s needed on site
                      </span>
                    </>
                  ) : (
                    <span style={{ color: BRAND.sub }}>
                      Put a site date in and the chase date works itself out.
                    </span>
                  )}
                </span>
                {orderTotal(draft) > 0 && (
                  <span style={{ fontSize: 13, color: BRAND.sub }}>
                    Total {money(orderTotal(draft))}
                  </span>
                )}
                <button
                  onClick={async () => {
                    const res = await send({ action: "add", ...draft });
                    if (res?.order) {
                      setShowing(res.order);
                      setDraft(BLANK);
                    }
                  }}
                  disabled={saving || !canEdit || !draft.customer.trim() || !draft.product.trim()}
                  style={{
                    ...btn,
                    marginLeft: "auto",
                    background: BRAND.green,
                    borderColor: BRAND.green,
                    color: "#fff",
                    padding: "7px 18px",
                    fontSize: 13,
                    opacity:
                      saving || !canEdit || !draft.customer.trim() || !draft.product.trim()
                        ? 0.6
                        : 1,
                  }}
                >
                  {saving ? "Saving…" : "Take the order"}
                </button>
              </div>
            </div>

            {templates && (
              <>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    marginBottom: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span style={{ fontSize: 13, color: BRAND.sub }}>
                    {showing
                      ? `Emails for ${showing.customer} — ${showing.product}`
                      : "Emails, filled in as you type above"}
                  </span>
                  {showing && (
                    <button onClick={() => setShowing(null)} style={miniBtn}>
                      Back to the one I&apos;m typing
                    </button>
                  )}
                  <button
                    onClick={() => setEditingTemplates((v) => !v)}
                    disabled={!canEdit}
                    style={{ ...miniBtn, marginLeft: "auto", color: BRAND.blue }}
                  >
                    {editingTemplates ? "Done editing" : "Edit the saved template"}
                  </button>
                </div>

                <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                  {[
                    { key: "confirmation", label: "Confirmation", mark: "confirmation" },
                    { key: "payment", label: "Request for payment", mark: "payment-request" },
                  ].map((panel) => (
                    <EmailPanel
                      key={panel.key}
                      label={panel.label}
                      template={templates[panel.key]}
                      order={subject}
                      saved={Boolean(showing)}
                      editing={editingTemplates}
                      saving={saving}
                      canEdit={canEdit}
                      copied={copied === panel.key}
                      onCopy={(text) => copy(text, panel.key)}
                      onSaveTemplate={(next) =>
                        send({ action: "template", templates: { [panel.key]: next } })
                      }
                      onSent={
                        showing
                          ? () =>
                              send({
                                action: "contact",
                                id: showing.id,
                                kind: panel.mark,
                                mark: panel.mark,
                                note: `${panel.label} sent`,
                              }).then((res) => res?.order && setShowing(res.order))
                          : null
                      }
                    />
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {section === "chase" && (
          <>
            {orders.length === 0 && !loading && (
              <p style={{ fontSize: 13, color: BRAND.sub }}>
                Nothing on the board yet — take an order on the other tab.
              </p>
            )}
            {BUCKETS.map((bucket) => {
              const rows = grouped.get(bucket.key) ?? [];
              if (rows.length === 0) return null;
              return (
                <section
                  key={bucket.key}
                  style={{
                    background: BRAND.card,
                    border: `1px solid ${bucket.urgent ? BRAND.amber : BRAND.line}`,
                    borderRadius: 10,
                    marginBottom: 14,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: "9px 12px",
                      background: bucket.urgent ? "#fdf4e6" : "transparent",
                      borderBottom: `1px solid ${BRAND.line}`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: bucket.urgent ? BRAND.amber : BRAND.ink,
                      }}
                    >
                      {bucket.label} ({rows.length})
                    </span>
                    {bucket.hint && (
                      <span style={{ fontSize: 11, color: BRAND.sub }}>{bucket.hint}</span>
                    )}
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                      <thead>
                        <tr>
                          <th style={th}>Customer</th>
                          <th style={th}>Product</th>
                          <th style={{ ...th, textAlign: "right" }}>Total</th>
                          <th style={th}>On site</th>
                          <th style={th}>Chase from</th>
                          <th style={th}>Last contact</th>
                          <th style={{ ...th, textAlign: "right" }} />
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((order) => (
                          <ChaseRow
                            key={order.id}
                            order={order}
                            bucket={bucket.key}
                            now={now}
                            saving={saving}
                            canEdit={canEdit}
                            onOpen={() => {
                              setShowing(order);
                              setSection("new");
                            }}
                            onSend={send}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </>
        )}
      </div>
    </main>
  );
}

/**
 * One email, filled from the order.
 *
 * Typing the wording fresh each time would save her nothing over the drafts
 * folder, so the template is kept once with the details as placeholders and
 * rendered against whatever order is in front of her. She can still edit what
 * comes out before copying — the template is a starting point, not a
 * straitjacket, and an edit here doesn't change the saved wording.
 */
function EmailPanel({
  label,
  template,
  order,
  saved,
  editing,
  saving,
  canEdit,
  copied,
  onCopy,
  onSaveTemplate,
  onSent,
}) {
  const filledSubject = fillTemplate(template.subject, order);
  const filledBody = fillTemplate(template.body, order);
  const [subject, setSubject] = useState(filledSubject);
  const [body, setBody] = useState(filledBody);
  const [draftTemplate, setDraftTemplate] = useState(template);

  // The order changed under it — re-fill, because what's on screen has to be
  // about the order she's looking at.
  useEffect(() => {
    setSubject(filledSubject);
    setBody(filledBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filledSubject, filledBody]);

  useEffect(() => {
    setDraftTemplate(template);
  }, [template]);

  if (editing) {
    return (
      <div
        style={{
          background: BRAND.card,
          border: `1px solid ${BRAND.blue}`,
          borderRadius: 10,
          padding: 12,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{label} — template</div>
        <div style={{ fontSize: 11, color: BRAND.sub, marginBottom: 8 }}>
          {"{{customer}} {{product}} {{qty}} {{price}} {{total}} {{siteDate}}"} fill themselves in.
        </div>
        <input
          value={draftTemplate.subject}
          onChange={(e) => setDraftTemplate({ ...draftTemplate, subject: e.target.value })}
          style={{ ...input, marginBottom: 8 }}
        />
        <textarea
          value={draftTemplate.body}
          onChange={(e) => setDraftTemplate({ ...draftTemplate, body: e.target.value })}
          rows={14}
          style={{ ...input, resize: "vertical", lineHeight: 1.5 }}
        />
        <button
          onClick={() => onSaveTemplate(draftTemplate)}
          disabled={saving || !canEdit}
          style={{
            ...btn,
            marginTop: 8,
            background: BRAND.green,
            borderColor: BRAND.green,
            color: "#fff",
          }}
        >
          {saving ? "Saving…" : "Save the template"}
        </button>
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
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: BRAND.sub }}>edit before you copy if you like</span>
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        aria-label={`${label} subject`}
        style={{ ...input, marginBottom: 8, fontWeight: 600 }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        aria-label={`${label} body`}
        rows={14}
        style={{ ...input, resize: "vertical", lineHeight: 1.5 }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button
          onClick={() => onCopy(`${subject}\n\n${body}`)}
          style={{ ...btn, color: BRAND.blue, borderColor: BRAND.blue }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        {/* Only once the order exists — there's nothing to record it against
            while she's still typing it. */}
        {saved && onSent && (
          <button onClick={onSent} disabled={saving} style={miniBtn}>
            Mark as sent
          </button>
        )}
        {!saved && (
          <span style={{ fontSize: 11, color: BRAND.sub }}>
            Take the order to record when you send it
          </span>
        )}
      </div>
    </div>
  );
}

/** One line on the chase board. */
function ChaseRow({ order, bucket, now, saving, canEdit, onOpen, onSend }) {
  const chase = chaseDate(order);
  const overdue = chase && chase < now;
  const last = lastContact(order);
  const chases = chaseCount(order);
  const daysToSite = daysBetween(now, order.siteDate);

  return (
    <tr>
      <td style={{ ...td, fontWeight: 600 }}>
        {order.customer}
        {chases > 1 && (
          <div style={{ fontSize: 11, fontWeight: 400, color: BRAND.amber }}>
            Chased {chases} times
          </div>
        )}
      </td>
      <td style={{ ...td, whiteSpace: "normal", minWidth: 160 }}>
        {order.product}
        <div style={{ fontSize: 11, color: BRAND.sub }}>{order.qty}</div>
      </td>
      <td style={{ ...td, textAlign: "right" }}>{money(orderTotal(order))}</td>
      <td style={td}>
        {shortDate(order.siteDate)}
        {daysToSite !== null && (
          <div style={{ fontSize: 11, color: daysToSite < 0 ? BRAND.red : BRAND.sub }}>
            {daysToSite < 0
              ? `${Math.abs(daysToSite)} days ago`
              : daysToSite === 0
                ? "today"
                : `in ${daysToSite} days`}
          </div>
        )}
      </td>
      <td style={{ ...td, color: overdue ? BRAND.amber : BRAND.ink }}>{shortDate(chase)}</td>
      <td style={{ ...td, color: BRAND.sub, whiteSpace: "normal", minWidth: 130 }}>
        {last ? (
          <>
            {new Date(last.at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
            <div style={{ fontSize: 11 }}>{last.note || last.kind}</div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        <button onClick={onOpen} style={{ ...miniBtn, color: BRAND.blue }}>
          {bucket === "payment" ? "Copy request" : "Copy chase"}
        </button>{" "}
        {bucket === "payment" ? (
          <button
            onClick={() =>
              onSend({ action: "contact", id: order.id, kind: "note", mark: "paid", note: "Paid" })
            }
            disabled={saving || !canEdit}
            style={{ ...miniBtn, color: BRAND.green, borderColor: BRAND.green }}
          >
            Paid
          </button>
        ) : bucket === "done" ? (
          <button
            onClick={() =>
              onSend({
                action: "contact",
                id: order.id,
                kind: "note",
                mark: "unpaid",
                note: "Marked unpaid again",
              })
            }
            disabled={saving || !canEdit}
            style={{ ...miniBtn, color: BRAND.sub }}
          >
            Not paid
          </button>
        ) : (
          <button
            onClick={() =>
              onSend({
                action: "contact",
                id: order.id,
                kind: "chase",
                note: "Chased",
              })
            }
            disabled={saving || !canEdit}
            style={{ ...miniBtn, color: BRAND.green, borderColor: BRAND.green }}
          >
            Chased
          </button>
        )}
      </td>
    </tr>
  );
}
