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
| `npm test` | Vitest — 649 tests |
| `npm run test:watch` | Same, watching |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:verify` | Runs every migration against real Postgres in Docker, then the RLS smoke suite |
| `npm run preview:docs` | Renders the estimate + photo report to HTML in `.preview/` so you can open them in a browser |
| `npm run lint` | `expo lint` |

`npm run web` is listed by the Expo template but **web is not a target** — the
bundle fails on `expo-sqlite`'s WASM build, and 99% of use is on a phone.

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
    damage/ notes/ scope/ billing/ onboarding/ settings/
  theme/        tokens, thumb-reachable target sizes
supabase/
  migrations/   9 migrations
  functions/ai/ Deno Edge Function — the only thing holding the Claude key
  test/         RLS + storage smoke suite
```

Routes: `/start`, `/sign-in`, `/settings`, `/prices`, `/prices/[id]`,
`/prices/import`, and per job `/job/[id]` plus `capture`, `room-wizard`,
`damage`, `notes`, `estimate`, `line`, `send`.

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

Nine migrations. **RLS is on for every table**, and the smoke suite asserts
that, along with cross-tenant refusal, storage isolation, share-link revocation,
the AI meter being unwritable by the party it meters, and billing state being
writable only by the Stripe webhook.

### Required configuration

Because sign-in uses OTP codes, **Supabase's default email template will not
work**. In the dashboard, under *Authentication → Email Templates → Magic Link*,
add `{{ .Token }}` to the body. The stock template contains only
`{{ .ConfirmationURL }}`, so no code is sent and verification always fails.

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
- Stripe checkout and the webhook endpoint. The schema and entitlement logic are
  done; the payment flow is not.
- A photo sort screen, for frames captured before a room existed.
- Analytics — specifically time-to-estimate, the one number that says whether
  this app is worth using.
- Store submission.

---

## Stack

Expo SDK 57 · React Native 0.86 · React 19.2 · expo-router · TypeScript 6 ·
Supabase (Postgres + RLS, Storage, Deno Edge Functions) · Vitest · Claude Opus 5
