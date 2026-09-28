// Off-the-shelf orders, as the board reads them.
//
// The same arithmetic as the server's copy, because both screens have to agree
// about which day she starts chasing. Worked out here, never stored: moving
// the site date moves the chase with it.

export const CHASE_LEADS = [7, 10, 14, 21, 28];

export function isDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));
}

export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

/**
 * The day to start chasing: the site date, less the lead she chose.
 *
 * Built from the date's own parts rather than through UTC, which in Adelaide
 * lands on the previous afternoon and quietly loses a day.
 */
export function chaseDate(order) {
  if (!isDay(order?.siteDate)) return "";
  const d = new Date(`${order.siteDate}T12:00:00`);
  d.setDate(d.getDate() - (Number(order.chaseLeadDays) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function daysBetween(from, to) {
  if (!isDay(from) || !isDay(to)) return null;
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

export function qtyCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const found = String(value ?? "").match(/\d+(?:\.\d+)?/g);
  return found ? found.reduce((s, n) => s + Number(n), 0) : 0;
}

export function orderTotal(order) {
  return Math.round(qtyCount(order?.qty) * (Number(order?.price) || 0) * 100) / 100;
}

export function money(value) {
  return `$${(Number(value) || 0).toLocaleString("en-AU", { minimumFractionDigits: 2 })}`;
}

/** "Thursday 1 October" — how a date reads in an email. */
export function longDate(day) {
  if (!isDay(day)) return day || "";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/** "Thu 1 Oct" — how it reads in a table. */
export function shortDate(day) {
  if (!isDay(day)) return "—";
  return new Date(`${day}T12:00:00`).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/**
 * What needs doing, rather than one list sorted by date.
 *
 * "Chase today" and "waiting on the money" are different jobs, and a board
 * that sorts them together makes her read every row to find the three that
 * matter this morning.
 */
export function bucketOf(order, now = today()) {
  if (order.paidAt) return "done";
  if (order.paymentRequestedAt) return "payment";
  const chase = chaseDate(order);
  if (!chase) return "later";
  if (chase <= now) return "now";
  const days = daysBetween(now, chase);
  return days !== null && days <= 7 ? "week" : "later";
}

export const BUCKETS = [
  {
    key: "now",
    label: "Chase now",
    hint: "The chase date has come or gone",
    urgent: true,
  },
  { key: "week", label: "Later this week", hint: "" },
  { key: "payment", label: "Awaiting payment", hint: "Invoice sent, money not in" },
  { key: "later", label: "Further out", hint: "" },
  { key: "done", label: "Paid", hint: "" },
];

export function contactsOf(order) {
  return [...(order?.contacts ?? [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function chaseCount(order) {
  return contactsOf(order).filter((c) => c.kind === "chase").length;
}

export function lastContact(order) {
  const list = contactsOf(order);
  return list.length ? list[list.length - 1] : null;
}

/** The template with this order's details in it. */
export function fillTemplate(text, order) {
  const values = {
    customer: order?.customer || "there",
    product: order?.product || "",
    qty: order?.qty || "",
    price: money(Number(order?.price) || 0),
    total: money(orderTotal(order)),
    siteDate: longDate(order?.siteDate),
    chaseDate: longDate(chaseDate(order)),
  };
  return String(text ?? "").replace(/\{\{(\w+)\}\}/g, (whole, key) =>
    key in values ? values[key] : whole
  );
}
