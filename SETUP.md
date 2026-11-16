# Stack Studio on Firebase — setup

Everything in this folder is written and ready. What is left needs a real
Firebase account, a Resend account for sending emails, and a few values
only you can provide.

---

## 1. Things only you can do

### a. Create the Firebase project
1. <https://console.firebase.google.com> → **Add project**.
2. Name it (e.g. `veplworks`). Google Analytics is optional; skip it.
3. **Upgrade to the Blaze (pay-as-you-go) plan** — required, not optional,
   for this OTP-by-email setup. OTP verification has to run as trusted
   server-side code (Cloud Functions), because a browser can never be
   trusted to grade its own answer to "was this code correct" — and Cloud
   Functions is not available on the free Spark plan.

   This is genuinely different from a Microsoft-sign-in setup, which could
   have stayed on Spark. Blaze still has a real free tier underneath it —
   2 million function invocations/month free — so at the scale of one
   internal engineering team, the honest expectation is $0/month in
   practice. But Blaze does require a billing card on the project, which
   Spark does not.

### b. Register a web app
Project settings → General → Your apps → **Web** (`</>`). Copy the config
object it shows you and paste the values into `firebase-init.js`
(the `REPLACE_ME` fields).

### c. Create a Resend account and verify your sending domain
OTP emails go out through [Resend](https://resend.com) — the same service
the earlier Node/SQLite backend used, reused here rather than introducing a
second provider.

1. Sign up at resend.com, free tier is enough to start.
2. Add and verify `veplworks.com` (or whichever domain you send from) under
   Resend → Domains — this adds DNS records at your registrar, same kind of
   step as pointing Hosting at your domain.
3. Create an API key: Resend → API Keys → Create.
4. Set it as a Cloud Functions secret (never hardcode it):
   ```bash
   firebase functions:secrets:set RESEND_API_KEY
   ```
   paste the key when prompted.
5. Confirm the `EMAIL_FROM` address in `functions/index.js`
   (`no-reply@veplworks.com`) matches a domain you actually verified in
   step 2 — Resend refuses to send from an unverified domain.

### d. Create the Firestore database
Firebase console → Firestore Database → Create database → **Production
mode** (not test mode — test mode is open to the world for 30 days).
Pick a region close to India, e.g. `asia-south1` (Mumbai).

---

## 2. Deploying

Install the CLI once:

```bash
npm install -g firebase-tools
firebase login
```

Install the Cloud Functions dependencies:

```bash
cd functions
npm install
cd ..
```

From the project folder:

```bash
firebase init        # choose Hosting + Firestore + Functions, select your project
firebase deploy      # ships hosting, the security rules, AND the two Cloud Functions
```

`firebase.json` already points hosting at `preview/`, rules at
`firestore.rules`, and functions at the `functions/` folder, so one
`firebase deploy` does all three.

**Deploy the rules before letting anyone sign in.** Until `firestore.rules`
is live, a production-mode database denies everything (safe), but a
test-mode one allows everything (not safe).

### Prove it works on the free test URL first

Every Firebase project gets a free `your-project.web.app` address the
moment you deploy. Use it before touching `veplworks.com`.

**What has been tested, honestly, and what hasn't:** the core OTP logic
(`functions/otp.js`) and rate limiting (`functions/rateLimit.js`) were run
against a hand-built, in-memory stand-in for Firestore — 11 tests, covering
the real state machine: correct code, wrong code, replay after success,
exhausting all 5 attempts, an unknown request id, an expired code, the 60s
cooldown, the per-email limit, and the per-IP limit. All 11 pass, against
the actual files, not a rewrite. That's real evidence the *logic* is
correct.

**What that stand-in cannot prove**: whether Resend actually delivers the
email, whether the real Firestore composite indexes are set up right, or
whether `signInWithCustomToken` on the client completes cleanly. Those need
the real services, which is exactly what the checklist below is for.

Test these five by hand on the `.web.app` URL:

1. Request a code with a real `@vedaengg.com` address — does the email
   arrive, and quickly?
2. Enter the code — does it sign you in?
3. Request a code for an address **outside** `@vedaengg.com` — no email
   should arrive, and the app should behave the same as if it had (see the
   note in `functions/index.js` on why the response is deliberately
   generic either way).
4. Save a design, close the browser, reopen, load it back — is it intact?
5. Sign in as a **second** `@vedaengg.com` address — can they see the
   first account's private design? They must not. Share it, check again —
   now visible, but not editable or deletable by them.

Point the real domain at it only after all five behave.

---

## 3. Custom domain

Firebase console → Hosting → **Add custom domain**.

It gives you DNS records to add at your registrar. Firebase provisions the
SSL certificate itself — nothing to buy, nothing to renew by hand.

- `stackstudio.veplworks.com` → this project (the only tool for now)
- `tankforge.veplworks.com` → added later, same Firebase project

The root `veplworks.com` is deliberately left unused for now — reserved for
the suite landing page once there is more than one tool. Stack Studio lives
on its own subdomain from day one specifically so it never has to move
later and break bookmarks.

Also add `stackstudio.veplworks.com` under Firebase → Authentication →
Settings → **Authorised domains** — sign-in is refused on any domain not
in this list, and the resulting error doesn't obviously point at this
setting.

---

## 4. What is still stubbed, honestly

- **`role` is always blank.** There is no job-title source in an OTP flow
  the way Entra could have supplied one for Microsoft sign-in. Left empty
  rather than guessed at.
- **No admin view.** There is no "see everything" role. Even you only see
  your own designs plus whatever others have shared. Adding an admin role
  means a custom claim plus a rules change — deliberate work, not an
  accident of omission.
- **Deleting a user's account does not delete their designs.** Their
  documents stay, owned by a uid that no longer signs in. That needs a
  Cloud Function on user deletion — same Blaze plan you're already on, so
  this is a smaller lift than it would have been under Spark, if you want
  it later.

---

## 5. Audit log

`audit-log.js` records who created, opened, saved, shared or deleted each
design. The approach is carried over from the earlier Node/SQLite backend,
which had it right: a calculation someone signs off on should have a
history.

It is wired into `cloud-designs.js` already — you do not call it by hand.

Two things to know:

- **Append-only, but not tamper-proof.** The rules refuse updates and
  deletes from every user, including the author. They do NOT stop whoever
  administers the Firebase project, who can change the rules or use the
  Admin SDK. Tamper-resistant, not tamper-proof against an administrator.
- **Readable by anyone at Veda.** Firestore can't check "may this person
  see the design this entry refers to" from within the rules, so audit
  entries are readable by any signed-in Veda account. They hold no design
  data — only who did what, when — so this is far less exposure than the
  designs themselves, which stay restricted.

You are already on Blaze for OTP, so writing these from a Cloud Function
with clients denied write access outright — for a trail that resists even
an administrator — is a smaller step than it would have been before. Still
a deliberate next step, not done here.
