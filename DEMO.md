# Demoing ScopeFlow

Every option below runs with **no backend and no `.env` keys** — the app works
locally, and the AI steps are answered by on-device demo rules that are labelled
as such on screen. To save everything to Supabase too, see
[With the hosted backend](#with-the-hosted-backend).

## Option 0 — host it yourself

`npm run export:portable` builds `dist-portable/`: a static folder that runs
from any host and any subfolder (Netlify, Vercel, GitHub Pages, S3). Upload the
folder's contents; no special headers are needed. Every visit starts fresh (the
database lives in memory), so a reload resets the demo. Where the page cannot
open a new tab, *Send the estimate* shows the document in an overlay.

## Option A — in a browser (easiest, screen-share friendly)

```bash
npm run demo:web          # builds, then serves http://localhost:8090
```

Open **one** tab at `http://localhost:8090` in Chrome or Edge. The app renders
in a phone-width column.

- Use a single tab. The database is shared by the whole origin, so a second
  tab waits for the first to close.
- `npm run serve:web` serves the last build without rebuilding.
- To start from a clean slate, run it on another port (`PORT=8091 npm run serve:web`)
  — browser storage is per port — or clear site data in DevTools.
- Plain `expo start --web` is **not** enough: expo-sqlite needs the two
  cross-origin-isolation headers that `scripts/serve-web.mjs` sends.
- The camera works on a laptop with a webcam; voice notes use the browser's
  speech recogniser in Chrome. Both are better shown on a phone.

## Option B — on a phone

```bash
npm start                 # then scan the QR code
```

- **Expo Go** runs everything except speaking a voice note (its native module
  is not in Expo Go); the notes screen falls back to typed notes.
- A **development build** (`eas build --profile development`) has everything,
  including on-device transcription.

## With the hosted backend

Everything is then saved to Supabase as well as the phone: jobs, rooms,
line items, estimates, notes, and photos in the private `job-media` bucket.

**One-time setup** (from the repo root):

1. Create a project at [supabase.com](https://supabase.com). Keep the database
   password.
2. `npx supabase login` (opens a browser), then
   `npx supabase link --project-ref <ref>` — the ref is the part before
   `.supabase.co` in the project URL; it asks for the database password.
3. `npx supabase db push` — creates every table, the security rules and the
   photo bucket. Do **not** add `--include-seed`: the seed is test data.
4. `npx supabase config push` — installs the sign-in email that carries the
   six-digit code (`supabase/templates/`). Without it, no code arrives.
5. In `.env`: `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   from the dashboard (Project Settings → API; the *anon* / *publishable* key,
   never the service role key), plus `EXPO_PUBLIC_AI_MODE=demo` and
   `EXPO_PUBLIC_DEMO_TOOLS=1`.
6. `npx expo start --clear` — `--clear` matters after any `.env` change.

**Sign-in email limits.** Supabase's built-in mailer only delivers to members
of your Supabase team, and only a few emails an hour. Sign in on the demo phone
the day before — the session persists. For a client to sign in with their own
address, add an SMTP provider under Authentication → Emails → SMTP Settings.

**Photos** upload their small copy on any connection and the full-size original
only on Wi-Fi, so "N photos uploading" on mobile data is expected.

The Edge Functions (`ai`, `billing`, …) are not needed for this: the demo AI
runs on the phone, and billing needs Stripe. See the README when you want them.

## A five-minute script

1. **Jobs → Load a sample job.** One tap builds a walked water loss at
   1418 Maple Avenue: three basement rooms, six photos, three voice notes, a
   damage sheet, a priced scope. Every number is computed by the real
   measurement engine from the room dimensions — nothing is canned.
2. **The job screen.** Point at the derived quantities on each room card: floor,
   net wall, baseboard, flood cut — all from three measurements and the
   openings. *"You measure three numbers; ScopeFlow does the arithmetic."*
3. **Add room** live: pick *Kitchen*, type `13` and `11`. Quantities appear as
   you type. Save.
4. **Sort 1 photo.** One photo came in untagged — file it under *Laundry*.
5. **Notes.** Three transcripts. *"Talk while you walk; the words become damage
   records you check."*
6. **Estimate.** Open *Family room*: template lines, plus AI suggestions with a
   confidence badge that are **not in the total until accepted**. Tap *Accept*
   on one and watch the net claim move.
7. Open *Laundry* → **Suggest what I missed.** New suggestions appear, each with
   its reason. Key point: *the AI cannot state a quantity — it names a measure
   ("floor area") and the number comes from the room's geometry.*
8. Scroll to **Totals**: overhead and profit, tax on materials only,
   depreciation on the aged carpet, deductible, net claim.
9. **Review and send → Freeze a version to send.** A frozen version can't be
   edited — revisions are version 2. **Draft a summary** writes the summary of
   loss.
10. **Send the estimate** opens the letterhead estimate (print → Save as PDF in
    a browser; the share sheet on a phone). **Photo report** shows the photos
    by room with time and GPS.

## What to say about the demo AI

The label under AI output reads *"Demo AI — rules running on this device, not
Claude."* That is accurate: with no backend there is no model call. Its
suggestions go through exactly the same checks as the real model's (codes must
be in the price list, quantities come from geometry, everything lands as a
suggestion), which is the part worth showing. With a Supabase project and an
Anthropic key configured, the same buttons call Claude through the `ai` Edge
Function.
