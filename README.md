# KK Financial Assistant

A personal financial tracker — a private ledger for lectures, referred
radiotherapy cases, and hospital work. Built with **React + TypeScript + Vite**
as a completely standalone single-screen app.

## Features

- **Record types** — lecture 🎓, referred case 🏥, hospital 🏨, other 📌; each
  with vendor/hospital, title, fee + currency (EGP/USD/EUR/SAR/AED), date,
  optional case reference and notes.
- **Vendor / Hospital list** — a Settings page (⚙️ in the header) manages a
  reusable list of vendors/hospitals; records pick from a dropdown (with a
  manual "Other" fallback) and the list doubles as a filter on the main
  screen. Renaming a vendor offers to update existing records.
- **Dedicated sign-up page** — creating an account collects name, email,
  phone number and country (stored as Supabase user metadata).
- **Paid / unpaid tracking** — one-tap paid toggle, per-currency summary cards
  (total, collected, outstanding).
- **Filters & sorting** — period filter (all time / this month / last month /
  this year / custom range), type chips, paid-status filter, free-text search,
  sort by date or fee.
- **Analytics** — collapsible by-type and by-site breakdowns, per currency,
  with outstanding amounts.
- **CSV export / import** — round-trips its own export format; import merges
  by id.
- **Optional follow-up reminders** — set a reminder date on an unpaid entry
  (backend-ready; see below).
- **Two-tier storage** — always works device-locally via `localStorage`; with
  Supabase configured and a signed-in account, records sync across devices.

## Quick start

```bash
cd kk-financial-assistant
npm install
npm run dev        # dev server at http://localhost:5174
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

No configuration is required — with no `.env`, the app runs in
**device-local mode**: everything is stored in the browser's `localStorage`
only, and the account bar shows a "Device-local mode" notice.

## Supabase sync (optional)

To sync records across devices:

1. Create your **own** Supabase project (this app must NOT share the project of
   any other app — it has its own schema).
2. In the Supabase SQL editor, run
   [`supabase/migrations/0001_finance.sql`](supabase/migrations/0001_finance.sql).
   It creates the `finance_entries` table with **owner-only RLS** — each row is
   visible only to the account that created it.
3. Copy `.env.example` to `.env` and fill in `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
4. Restart the dev server. Use the account bar at the top to **sign up** /
   **sign in** (email + password). Once signed in, the ledger syncs: the badge
   under the summary switches from "Saved on this device" to "Synced via your
   account".

Core sync needs **only migration 0001**. Also run
[`supabase/migrations/0003_vendors.sql`](supabase/migrations/0003_vendors.sql)
so the Vendor / Hospital list (Settings page) syncs too — without it the list
still works but stays device-local.

### Troubleshooting sign-in

If sign-up / sign-in "does nothing" or errors, check these in your Supabase
project dashboard:

1. **Email provider enabled** — Authentication → Sign In / Providers → make
   sure **Email** is enabled. If it is disabled, sign-up fails with
   "sign-ups are disabled".
2. **Email confirmation** — by default Supabase requires new users to click a
   confirmation link before they can sign in, so after sign-up the app shows
   "Account created. Check your email…" and signing in fails with "Email not
   confirmed" until the link is clicked. Either:
   - turn **OFF** "Confirm email" (Authentication → Sign In / Providers →
     Email) — simplest, users are signed in immediately after sign-up; **or**
   - keep it on and configure **Authentication → URL Configuration**: set
     **Site URL** to your deployed URL (e.g. your Vercel domain) and add it to
     **Redirect URLs** — otherwise confirmation emails link to
     `localhost:3000` and the confirmation link appears broken.
3. **Password length** — the default minimum password length is **6
   characters**; shorter passwords are rejected.
4. **Privacy** — each account's data is private via row-level security: users
   only ever see their own entries, even though all accounts share one
   database.

## Payment reminders (optional, backend-ready)

The data model and backend support push reminders for unpaid entries whose
follow-up date has passed, but the **client-side push subscription code is not
included** in this app — reminders are a backend-ready, client-optional
feature. You can skip this section entirely; everything else works without it.

To enable them you need, in this app's own Supabase project:

1. A `push_subscriptions` table with columns `endpoint` (pk), `user_id`,
   `p256dh`, `auth`, plus your own client code that subscribes the browser to
   Web Push and stores the subscription there.
2. Your own **VAPID key pair**, set as Edge Function secrets:
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
3. Deploy the function:
   `supabase functions deploy notify-due-payment`
   (source in [`supabase/functions/notify-due-payment/`](supabase/functions/notify-due-payment/)).
4. Run [`supabase/migrations/0002_reminders.sql`](supabase/migrations/0002_reminders.sql)
   after replacing the `__PROJECT_REF__` / `__SERVICE_ROLE_KEY__` placeholders.
   It schedules an hourly `finance-notifier` pg_cron job that invokes the
   function.

The function finds unpaid entries with a passed `remind_at` that haven't been
notified, pushes a reminder to each of the owner's subscribed devices, stamps
`notified_at` (so it fires once), and prunes dead subscriptions. Editing an
entry re-arms its reminder; marking it paid stops reminders.

## Deploying

Deploy as its **own** project, independent of any other app in the repository.
For example on Vercel: create a new project from this repo and set
**Root Directory** to `kk-financial-assistant` — the defaults
(`npm run build`, output `dist/`) work as-is. Set the two `VITE_SUPABASE_*`
environment variables in the project settings if you use sync.

## Install as an app (PWA)

Once deployed, the app can be installed to your phone's home screen and used
like a native app:

- **iPhone / iPad:** open the deployed URL in **Safari**, tap the **Share**
  button, then **Add to Home Screen**.
- **Android:** open it in **Chrome** and tap **Install app** (or menu →
  **Add to Home screen**).

The app shell is cached by a service worker, so it opens and works offline;
data entered offline lives in local storage and syncs to Supabase when you're
back online (if sync is configured). Updates are picked up automatically on
the next visit.
