# Decor Production Feed — structure and architecture

A briefing document. It describes what the system is, how it is put together,
and why it is put together that way. Written to be handed to someone (or
something) that needs to discuss the system without having read the code.

---

## 1. What it is

Decor Systems makes acoustic panels. A job passes through drafting, material
ordering, the factory floor, dispatch and invoicing, and historically each of
those steps kept its own record — a spreadsheet, an email, a job ticket, a
whiteboard. The same fact was written five times and disagreed with itself by
Thursday.

The production feed is the screen half of a system that fixes that: **a fact is
entered once, by the person who owns it, and every other screen reads it.**

It is not an ERP. It is a set of working boards, each one shaped around one
person's actual job, sitting on a shared spine of data.

| Board | Whose it is | What they do on it |
|---|---|---|
| Production schedule | everyone | Read-only view of the master schedule, straight from SharePoint |
| Schedule board | Duncan (production manager) | Dates, priority, process steps, wastage |
| Material orders | Alice (purchasing) | What to order, from whom, PO/OC numbers, arrivals, lead times |
| Warehouse | the dock | Tick off deliveries as they come through the door |
| Stock | Alice | Ledger of material on hand, leftovers, write-offs |
| Material list | Mitch (drafting), managers | The register of every finish we buy and who supplies it |
| Invoicing | Veronica | Mark a job charged |
| Request a change | everyone | Ask for a change to these screens (about the app, not the work) |
| Handover (external) | Mitch | Writes the job up in the first place — separate app |

---

## 2. The two apps

There are two Next.js 15 (App Router) applications, deployed separately on
Vercel, sharing one Firebase project.

### `production-feed` — the boards (JavaScript)
`C:/Users/Michael/OneDrive - Decor Systems/Desktop/ProFlow/Production-Widget/production-feed`

React 19, plain JavaScript, **inline styles only** (no CSS framework, no
component library). Installable as a desktop PWA. This app renders everything
and owns almost no data: most of its `/api/*` routes are thin proxies that add
a shared secret and forward to the handover app.

### `decorhandover` — the data layer (TypeScript)
`C:/Users/itdec/OneDrive/Desktop/decorhandover` → `decorhandover.lyphex.com`

TypeScript (strict), Firebase Admin SDK, Tailwind. Holds Mitch's handover form
*and* every server-side rule in the system. If a fact is written to Firestore,
it goes through a route in this app. The schema lives here too
(`src/lib/handoverSchema.ts`, ~1,600 lines) and is the single definition of
what a job is.

The split is historical but has held up: the feed is the fast-moving UI, the
handover app is the contract.

### Related, not part of this
- **ProFlow / Decorflow** (`Desktop/Decorsystems`) — the older CRA + Firebase
  app. Still the system of record for **staff accounts and roles** (the `users`
  collection), which both apps read.
- **client-tracker** — customer-facing project tracker. The feed generates
  unguessable per-project links for it (`lib/token.js`, HMAC of the base CRM).
- **decoracoustic** — static NRC calculator, linked from the nav as a reference.

---

## 3. Where the data actually comes from

Four sources, deliberately not merged:

1. **SharePoint Excel** — `Production Schedule 2026 Current.xlsx`, read via
   Microsoft Graph with an app-only service principal (`Sites.Selected`). The
   file is downloaded as bytes and parsed (`lib/graph.js`, `lib/parseSchedule.js`)
   rather than read through the Excel workbook API, which is unreliable for
   files the app doesn't own. The schedule is still Jordan's spreadsheet; the
   feed does not own it and does not write to it.
2. **Asana** — the "3. Production" project. Each task's due date is the date a
   job should leave the factory. `lib/asana.js` matches tasks to jobs by the
   CRM prefix in the task name (tolerant of `#`, of `-part` suffixes, and of
   whitespace) and flags disagreements. It is a **cross-check, not a source of
   truth**: if Asana is unreachable the schedule still renders, with a warning.
3. **Firestore** — everything the system itself owns: handovers, material
   stock, pre-orders, the material list, requests.
4. **ProFlow `users`** — who works here and what role they have.

---

## 4. Request flow

The shape of nearly every interaction:

```
browser (board page)
  → /api/<thing>            feed route: adds JOB_API_SECRET, forwards
    → decorhandover /api/<thing>   verifies identity, checks role,
                                   runs a Firestore transaction
      → Firestore
```

The schedule is the exception — it goes to Graph and Asana directly, because
that data isn't ours:

```
browser → /api/schedule → Microsoft Graph (xlsx) + Asana (due dates) → parsed JSON
```

Nothing is cached in the browser. Every page polls on a timer that **pauses
while the tab is hidden** (`pollWhenVisible`) and reloads on window focus.
Intervals: 15 minutes for the schedule, board, materials, stock and invoicing;
**60 minutes for the warehouse**, because material takes days to arrive and
there is nothing to see more often than that.

---

## 5. Authentication and permissions — four layers

They stack; each one exists because the one above it isn't enough.

1. **A shared password on the front door.** Middleware (`middleware.js`) gates
   every path except `/unlock`, `/api/login` and static assets. The cookie
   holds an HMAC-signed marker, not the password (`lib/auth.js`, Web Crypto so
   it runs in Edge middleware). This keeps the boards off the open internet.
   It identifies nobody.
2. **A Firebase identity.** Staff sign in with the same email and password they
   use for Decorflow — same Firebase project, same accounts. Any write carries
   a Firebase ID token, which the server verifies (`emailFromIdToken`) and
   checks against the allowed domain (`emailAllowed`, default
   `@decorsystems.com.au`, with an env override for contractors). This is how a
   record gets a name on it.
3. **A role, read from ProFlow.** `src/lib/roles.ts` maps email → role →
   capabilities. Roles are assigned in ProFlow's Team tab — one place, no
   redeploy, and the Firestore rules read the same document.
4. **Firestore security rules.** The real gate. An app-side check is a courtesy
   that a devtools console walks straight past.

Plus a fifth, sideways: **machine auth.** `JOB_API_SECRET` is a shared bearer
secret used for app-to-app calls in both directions (constant-time compare,
fails closed). It authorises the *app*, never a person — routes that need a
name still demand an ID token.

### Capabilities

| | processSteps | schedule | receiving | materials | invoicing | handover | manage |
|---|---|---|---|---|---|---|---|
| admin / manager | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| operator (floor) | ✓ | — | ✓ | — | — | — | — |
| viewer | — | — | — | — | — | — | — |
| pending | — | — | — | — | — | — | — |

`tabs` is part of the same object — a board somebody can't use is a board in
the way, so it isn't shown. `receiving` is deliberately separate from
`materials`: signing for what arrived is not the same as deciding what to buy,
and the dock shouldn't need Alice's board to do it.

The client is **optimistic** while the role loads (`useCapabilities`): the write
endpoints decide, and greying out Alice's own board because a lookup was slow
is worse than showing a button that turns out to be refused.

Two things worth knowing because they cost real time:
- `pending` is the default for any unrecognised account. An account nobody has
  approved should not inherit rights by not being found.
- The role lookup is **case-insensitive by necessity**. ProFlow stores the
  address as typed (`Duncan.jones@…`); tokens hand back lowercase. An `==`
  query found nothing, "nothing" meant pending, and an admin got a read-only
  board. The indexed query is the fast path; a cached scan of the collection
  backs it up.

---

## 6. The domain model

### Handover — the upstream document
Mitch writes a handover before anything is scheduled. It is where a job becomes
real, and it carries: job/CRM id, project, client, panels and products,
materials, accessories, processes, packing, charges, take-off, attachments,
schedule and invoice state. `handoverSchema.ts` defines all of it.

### Material lines
Each material line carries finish, substrate, sizes, quantity, **spare**,
supplier, PO number, supplier OC number, and timestamps for ordered/arrived.
Line state is **derived**, not stored (`lineState()`): from stock / to order /
ordered / part-delivered / arrived. Part deliveries work by accumulating
received quantity against the expected total.

### Material list
The register of every finish we buy and who supplies it, seeded with 23
finishes and 9 substrates. Every picker in the system is **list-only** —
Alice's board offers exactly what Mitch's list holds. This exists because
"Blackbutt" and "Blackbutt NTV" and "blackbutt laminate" were three different
products and one stock balance.

### Pre-orders
Material ordered before a job exists, usually in bulk for stock. Editable —
with a who/when stamp — right up until Alice orders it, then frozen. On
arrival it either lands against a job or moves into stock.

### Material stock — a ledger, not a number
`materialStock` is append-only entries (`leftover`, `manual`, `preorder`,
`scheduled`), and balances are summed from them. Stock assigned to a job is
drawn *through the line* and stamped (`stockDrawnAt/By/Qty`) so the same sheet
can't be counted twice. Dimensions are normalised on write and on display
(`dimension()`) after `9mm` and `9` spent a while being two different materials
and a card read "9mmmm".

### Requests
Anyone raises one, everyone reads them, a manager answers and can delete an
answered one. Deliberately **not email** — the boards are checked daily and
another inbox is another thing to ignore.

---

## 7. Design principles the code actually follows

- **Derive, don't store.** Line state, order quantities, wastage, batches,
  lead times, job state — all computed from the facts underneath. A stored
  status is a status that goes stale and then lies.
- **One list.** Every dropdown that names a material reads the material list.
  Free text is how you get six versions of the same product.
- **The server decides.** Every rule is enforced in a route handler; the UI only
  declines to offer what it knows will be refused.
- **Transactions for anything read-then-written.** Firestore `runTransaction`
  on line updates, draws, schedule changes, orders, answers. Two people editing
  two lines of the same job used to lose one of the edits.
- **Nothing nags unless it's work.** Counts sit on boards. The requests link and
  the acoustic reference sit off the tab strip, quiet, because they are not
  places your job takes you.
- **Fail useful, not closed** (where safety allows). Asana down → schedule still
  renders with a warning. Role lookup slow → assume capable, let the server
  refuse. Role lookup *fails* → pending, because that one is a security answer.

---

## 8. Deployment and configuration

Both apps deploy on Vercel from GitHub; the feed auto-deploys on push. Firebase
project: `decor-systems-f017a`, shared by both apps and ProFlow.

**Feed env:** `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`ASANA_TOKEN`, `FEED_PASSWORD`, `JOB_API_SECRET`, `HANDOVER_APP_URL`,
`LINK_SECRET`, `TRACKER_BASE_URL`, `NEXT_PUBLIC_FIREBASE_*`.

**Handover env:** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
`FIREBASE_PRIVATE_KEY`, `JOB_API_SECRET`, `PRODUCTION_FEED_URL`,
`NEXT_PUBLIC_ALLOWED_DOMAIN`, `NEXT_PUBLIC_ALLOWED_EMAILS`,
`NEXT_PUBLIC_FIREBASE_*`.

**Local development note:** the feed's path contains a space
(`OneDrive - Decor Systems`), which breaks `npm --prefix`. A junction under the
temp directory is used to work around it.

---

## 9. Current constraints and open items

- **Firebase is on the Spark (free) plan** — 50k reads/day. Read volume has been
  cut with an in-process TTL cache (`src/lib/cache.ts`, 20s/120s) and by pausing
  polling on hidden tabs, but Blaze is the right answer before more users. Reads
  cost about $0.06 per 100k.
- A handful of historic materials are **overdrawn** — more drawn than the
  register ever held, from stock logged under a name it didn't hold. The stock
  page surfaces these with "enter what's on the rack" and "write it off".
- `pre-orders/arrive` and `handovers/rename` still use batch writes rather than
  transactions. Lower risk, not yet converted.
- No email anywhere in the system, by decision.
