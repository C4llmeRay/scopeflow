# ScopeFlow

Turn a property inspection into a repair estimate, from a phone, in a basement,
with no signal.

A contractor walks the damage, measures rooms, shoots photos and talks into the
phone. ScopeFlow works out the quantities, drafts the scope, prices it against
their own price list, and produces an estimate and photo report to send to the
homeowner or the carrier — then tracks the job from inspection through
completion.

**Status: MVP, not yet run on a physical device.** Everything below is built and
tested, but it has never been pointed at a real Supabase project, a real phone,
or the real Claude API. See [What's left](#whats-left).

---

## The two constraints that shaped everything

**1. The phone is the source of truth, not the server.**
Adjusters and contractors work in basements, crawlspaces and half-demolished
houses. So SQLite on the device is authoritative, and Supabase is where work
*lands* when there is signal — never something the app waits on. No screen in
this app blocks on the network.

**2. Money is never a float, and quantities are never guessed.**
Dimensions are integer inches, money is integer cents. And the AI cannot invent
a number — see [How the AI can't hallucinate a quantity](#how-the-ai-cant-hallucinate-a-quantity).

---

## Quickstart

Requires **Node 22+** (the test suite uses `node:sqlite`, unflagged from 22) and
**Docker** if you want to verify the schema.

```bash
npm install
cp .env.example .env     # fill in your Supabase URL + anon key
npm start                # then scan the QR with Expo Go or a dev client
```

The app runs fine **with an empty `.env`** — with no backend configured it works
locally under a placeholder company, which is what makes it usable before
Supabase exists.

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run android` / `ios` | Dev server, opening that platform |
| `npm test` | Vitest — 724 tests |
| `npm run test:watch` | Same, watching |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:verify` | Runs every migration against real Postgres in Docker, then the RLS smoke suite |
| `npm run preview:docs` | Renders the estimate + photo report to HTML in `.preview/` so you can open them in a browser |
| `npm run lint` | `expo lint` |
| `npm run demo:web` | Builds the web version and serves it with the headers expo-sqlite needs, on `:8090` |
| `npm run serve:web` | Serves the last web build without rebuilding |

**Demoing:** see [DEMO.md](DEMO.md). With no backend configured, the job list
offers *Load a sample job*, and the AI buttons are answered by labelled
on-device rules (`src/features/ai/demo.ts`) instead of Claude.

The **web build is for demos**, not a product target — 99% of use is on a
phone. It needs cross-origin isolation (expo-sqlite uses SharedArrayBuffer),
which `scripts/serve-web.mjs` provides and `expo start --web` does not.

---

## Architecture

### Offline spine

Three queues, drained in a fixed order:

1. **`sync_outbox`** — row changes. Head-of-line blocking is *on*: if one push
   fails transiently the queue stops, because rows have foreign keys and
   reordering them would push a line item ahead of the room it belongs to.
2. **`upload_queue`** — photo and audio binaries. Head-of-line blocking *off*;
   one stuck 40 MB upload must not hold up the other nineteen.
3. **`ai_queue`** — inference requests. Last, because the Edge Function
   validates job ownership server-side, so the job row has to exist there first.

All three are the same implementation: `outboxSchema(table)` in
`src/sync/sqlite-store.ts` is parameterized by table name, and both the SQLite
and in-memory stores are held to one shared spec (`outbox-conformance.ts`).

The tests run the **shipping SQL** — the same statements the device executes —
against `node:sqlite`. Not a mock, not a stub.

### How the AI can't hallucinate a quantity

The structured-output schema for scope suggestions has **no numeric quantity
field at all**. The model returns the *name* of a measure (`FLOOR_SF`,
`WALL_SF_NET`, `PERIMETER_LF`, …) and the device looks up the number the
measurement engine already computed:

```ts
resolveQuantity(basis, quantities)   // src/features/ai/contract.ts
```

A wrong quantity is therefore not representable in the response. The model can
still suggest the wrong *line item* — that is a judgement call, and it is
reviewable — but it cannot claim a room has 340 SF of floor when it has 168.

Every AI-inserted line lands as `suggested`, forced by a database trigger on
insert; only a human can accept one. Acceptance rates are tracked
(`acceptance.ts`), and a prompt that falls below a 60% floor over 10+ samples is
flagged rather than silently trusted.

### Money

`roundCents` rounds half-away-from-zero after snapping through
`Number(n.toPrecision(12))`. The obvious implementation is wrong: `1.005 * 100`
is `100.49999999999999` in IEEE 754 and rounds *down*, and nudging by
`Number.EPSILON` does nothing at money magnitudes, because EPSILON is relative
to 1.0.

Every line total is derived as `materialCents + laborCents`, so an estimate's
parts always reconcile with its total. Material and labor are tracked separately
because **sales tax applies to materials only** — a single blended price cannot
be taxed correctly.

### Auth

Email plus a **six-digit code**, not a magic link. A link has to survive a mail
client, a redirect, and a deep-link association on a phone that may not have the
app installed yet; a code works from any device.

Four phases: `loading` → `local` | `signed-out` | `signed-in`. The rule is that
**a cached session is enough to work** — signing in is the only thing in
ScopeFlow that genuinely needs signal, so if the company cannot be resolved the
app falls back to local mode rather than locking a contractor out of their own
jobs.

Work recorded before signing in is adopted into the real company
(`src/features/auth/adopt.ts`): rows, the profile, and the tenant id *inside
already-queued payloads*, which would otherwise be refused by RLS forever.

### Billing

Stripe Checkout in a system browser — the app never sees a card number, so it
cannot leak one. Three functions: `billing` mints Checkout and Billing Portal
URLs, `billing-return` is an https hop back to the app (Stripe refuses to
redirect to a `scopeflow://` URL), and `stripe-webhook` is **the only thing
allowed to say a company has paid**. Nothing marks a subscription active from
the success redirect; a redirect is a URL anyone can open.

The webhook is built around two facts Stripe states plainly and integrations
routinely ignore. Delivery is **at least once**, so the event id is a primary
key and a replay collides. Delivery is **unordered**, so an event older than
the last one applied is recorded and dropped — otherwise a stale `active`
arriving after a cancellation silently undoes it.

The decision logic is pure and lives in
`supabase/functions/_shared/subscription.ts`, imported directly by the Vitest
suite rather than copied, so the tests run the code that ships. It also handles
the field Stripe moved: `current_period_end` lives on the subscription *item*
from API version 2025-03-31 onward, and reading only the old location returns
null silently — which is what the grace-period maths measures from.

Billing state is the one thing that syncs **downward**. Everything else in
ScopeFlow is pushed from the phone; the phone is not allowed to decide whether
the contractor has paid.

---

## Layout

```
src/
  app/          expo-router file routes (see below)
  core/         pure domain: units, measure, estimate, floodcut — no I/O
  db/           local SQLite schema + one repository per table
  sync/         the three queues, backoff, failure classification
  features/
    ai/         prompts, contract, cost ceiling, acceptance tracking
    auth/       identity, sign-in form logic, pre-auth data adoption
    documents/  estimate + photo report HTML, CSV, PDF, sharing
    rooms/      room wizard, openings editor, dimension parsing
    pricing/    CSV import, price forms, starter list
    billing/    entitlement rules, Stripe checkout, downward sync
    photos/     the untagged-photo sort queue
    metrics/    time to estimate
    damage/ notes/ scope/ onboarding/ settings/
  theme/        tokens, thumb-reachable target sizes
supabase/
  migrations/   10 migrations
  functions/    ai, billing, billing-return, stripe-webhook (Deno)
  functions/_shared/  pure logic the app's own test suite imports directly
  test/         RLS + storage + billing smoke suite
```

Routes: `/start`, `/sign-in`, `/settings`, `/subscribe`, `/prices`,
`/prices/[id]`, `/prices/import`, and per job `/job/[id]` plus `capture`,
`room-wizard`, `damage`, `notes`, `sort`, `estimate`, `line`, `send`.

`src/core/` is pure and imports nothing else from the app — it is the part worth
trusting.

---

## Backend

```bash
supabase start
supabase db reset          # applies migrations/ and seed.sql
supabase functions deploy ai
npm run db:verify          # or check it against plain Postgres in Docker
```

Ten migrations. **RLS is on for every table**, and the smoke suite asserts
that, along with cross-tenant refusal, storage isolation, share-link revocation,
the AI meter being unwritable by the party it meters, and billing state being
writable only by the Stripe webhook.

### Edge Functions

Three, and two of them need a deploy flag that is easy to miss:

```bash
supabase functions deploy ai
supabase functions deploy billing
supabase functions deploy stripe-webhook  --no-verify-jwt   # required
supabase functions deploy billing-return  --no-verify-jwt   # required
```

`--no-verify-jwt` is not optional on those two. Supabase verifies a JWT on
functions by default; Stripe does not send one, and neither does a browser
coming back from a Stripe page. Without the flag every webhook is rejected with
a 401 and the first you know about it is a customer who paid and cannot send.
The webhook still authenticates — by verifying Stripe's signature, which is the
correct check for that endpoint.

### Required configuration

Three things the code cannot do for itself.

**1. The sign-in email template.** Sign-in uses OTP codes, so **Supabase's
default template will not work**. In the dashboard, under *Authentication →
Email Templates → Magic Link*, add `{{ .Token }}` to the body. The stock
template contains only `{{ .ConfirmationURL }}`, so no code is sent and
verification always fails.

**2. Stripe secrets**, set on the functions, never in the app:

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_PRICE_ID=price_...          # the monthly plan
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...    # from the endpoint
```

**3. The webhook endpoint**, in the Stripe dashboard, pointed at
`https://<project>.supabase.co/functions/v1/stripe-webhook`, subscribed to:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Test it with `stripe trigger customer.subscription.updated` before trusting it.

### Secrets

- `EXPO_PUBLIC_SUPABASE_ANON_KEY` is **safe to ship** in the bundle — it is a
  public identifier, and every table is behind RLS.
- The **service role key must never appear in the app.** It lives only in the
  Edge Function environment.
- The **Anthropic API key is never on the device.** The app calls the `ai` Edge
  Function, which checks auth, checks job ownership, and checks the company's
  spend ceiling *before* making the call.

---

## Rules this codebase keeps

- **Never import Xactimate price data.** It is licensed and has been litigated.
  Contractors bring their own price list via CSV, or start from a generic seed
  list that is clearly labelled as not being pricing for their area.
- **Photos are evidence.** Originals are never re-encoded — EXIF, GPS and
  capture time survive, because that metadata is a contractor's defence in a
  disputed claim two years later. A compressed derivative is generated for
  upload and display. Deletes are soft, and the `job-media` bucket has no delete
  policy at all.
- **Billing state is written only by the Stripe webhook**, enforced by a
  database trigger rather than by convention.
- **A sent estimate is frozen.** Line edits are refused at the database level;
  only a status advance is allowed.

---

## What's left

- Nothing has run on a **physical device**, against a **real Supabase project**,
  or against the **real Claude API**. That is the next thing.
- Store submission — and one policy question to settle first. Apple requires
  in-app purchase for digital subscriptions, with a carve-out for business
  software sold to businesses (App Store Review Guideline 3.1.3(e)). ScopeFlow
  is B2B and plausibly sits inside it, but "plausibly" is not a filing strategy:
  confirm the classification before submitting, or the review is rejected and
  the billing flow has to be rebuilt on StoreKit. Google Play's equivalent
  carve-out is broader and Stripe is fine there.
- Email delivery of an estimate straight from the app, rather than the share
  sheet.

---

## Stack

Expo SDK 57 · React Native 0.86 · React 19.2 · expo-router · TypeScript 6 ·
Supabase (Postgres + RLS, Storage, Deno Edge Functions) · Vitest · Claude Opus 5
