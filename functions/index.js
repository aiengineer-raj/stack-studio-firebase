/**
 * Cloud Functions: requestOtp and verifyOtp.
 *
 * These are the two functions the client calls (see auth.js). Everything
 * security-bearing lives here, server-side, specifically because none of it
 * is safe to run in the browser:
 *   - only Cloud Functions can hold the Resend API key
 *   - only Cloud Functions (via the Admin SDK) can mint a real Firebase
 *     Auth session -- a client can generate a code, but it can never be
 *     trusted to grade its own answer
 *
 * THE BRIDGE, which is the one piece of design worth explaining clearly:
 * verifyOtp(), on success, does NOT invent its own session mechanism. It
 * uses the Admin SDK to get-or-create a real Firebase Auth user for that
 * email, then mints a Firebase custom token for it. The client exchanges
 * that token for a normal Firebase Auth session
 * (signInWithCustomToken in auth.js).
 *
 * That one design choice is why NOTHING else in this project has to change.
 * firestore.rules, designs.js, cloud-designs.js and audit-log.js all key off
 * request.auth / auth.currentUser -- none of them know or care whether the
 * session behind it came from Microsoft or from an OTP. Swapping the sign-in
 * METHOD did not require touching the data layer at all.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const { createOtpRequest, verifyOtp: verifyOtpLogic, VERIFY_RESULT } = require('./otp');
const { checkRateLimit, recordRateLimitEvent, RATE_LIMIT_REASON } = require('./rateLimit');
const { sendOtpEmail } = require('./email');

admin.initializeApp();
const db = admin.firestore();

// DUPLICATED from firebase-init.js's ALLOWED_EMAIL_DOMAIN, deliberately --
// Cloud Functions run in a separate Node/Admin-SDK environment and cannot
// import a browser ES module. If the allowed domain ever changes again
// (as it already did once, from vedaengineering.com to vedaengg.com),
// it must be updated in BOTH this file and firebase-init.js, and the
// email.lower().matches(...) line in firestore.rules is a third place
// carrying the same value. Three places, not two, now that OTP exists.
const ALLOWED_EMAIL_DOMAIN = 'vedaengg.com';

// Set via: firebase functions:secrets:set RESEND_API_KEY -- never hardcoded.
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
// The "from" address must be on a domain verified in your Resend account.
const EMAIL_FROM = 'Stack Studio <no-reply@veplworks.com>';

function normaliseEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

function isVedaEmail(email) {
  return email.endsWith('@' + ALLOWED_EMAIL_DOMAIN);
}

/**
 * requestOtp({ email }) -> { requestId, expiresInSeconds }
 *
 * Deliberately returns the SAME generic response whether the email is
 * authorised or not, and whether rate-limited or not -- a caller who is
 * probing for which addresses exist at Veda should learn nothing from the
 * response shape. The actual outcome (sent, denied, rate-limited) is only
 * ever distinguishable by whether an email arrives, same as the original
 * backend's approach.
 */
exports.requestOtp = onCall({ secrets: [RESEND_API_KEY] }, async (request) => {
  const email = normaliseEmail(request.data && request.data.email);
  const ipAddress = request.rawRequest ? request.rawRequest.ip : null;

  if (!email || !email.includes('@')) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }

  // Generic response for a non-Veda address: no request is created, no
  // email is sent, but the client sees the same shape as a real request.
  // This is what stops the endpoint being used to enumerate valid accounts.
  if (!isVedaEmail(email)) {
    return { requestId: 'noop-' + Date.now(), expiresInSeconds: 300 };
  }

  const limited = await checkRateLimit(db, email, ipAddress);
  if (limited) {
    // Also generic to the client -- but distinguishable server-side via
    // Cloud Functions logs, which is where you would look if someone
    // reported "my code never arrived."
    return { requestId: 'noop-' + Date.now(), expiresInSeconds: 300 };
  }
  await recordRateLimitEvent(db, email, ipAddress);

  const { id, otp, expiresAt } = await createOtpRequest(db, email, ipAddress);

  // If the email fails to send, the request document already exists but no
  // one has the code -- that is a dead end, not a security hole, so it is
  // safe to surface honestly rather than pretend it worked.
  try {
    await sendOtpEmail({
      apiKey: RESEND_API_KEY.value(),
      fromAddress: EMAIL_FROM,
      toEmail: email,
      otp,
    });
  } catch (err) {
    console.error('OTP email send failed for', email, err);
    throw new HttpsError('internal', 'Could not send the code. Try again shortly.');
  }

  return { requestId: id, expiresInSeconds: Math.round((expiresAt - Date.now()) / 1000) };
});

/**
 * verifyOtp({ requestId, code }) -> { token }
 *
 * `token` is a Firebase custom token. The client calls
 * signInWithCustomToken(auth, token) with it -- see auth.js.
 */
exports.verifyOtp = onCall(async (request) => {
  const requestId = String((request.data && request.data.requestId) || '');
  const code = String((request.data && request.data.code) || '').trim();

  if (!requestId || !code) {
    throw new HttpsError('invalid-argument', 'Missing request id or code.');
  }
  if (requestId.startsWith('noop-')) {
    // The generic response path from requestOtp -- there is no real request
    // behind this id, so it can never verify. Same user-facing message as
    // a genuine wrong code, so nothing distinguishes "you don't have an
    // account" from "you mistyped the code."
    throw new HttpsError('permission-denied', 'That code is incorrect or has expired.');
  }

  const outcome = await verifyOtpLogic(db, requestId, code);

  switch (outcome.result) {
    case VERIFY_RESULT.OK:
      break; // fall through to minting the token, below
    case VERIFY_RESULT.INCORRECT:
      throw new HttpsError('permission-denied', 'That code is incorrect or has expired.');
    case VERIFY_RESULT.EXPIRED:
      throw new HttpsError('deadline-exceeded', 'That code has expired. Request a new one.');
    case VERIFY_RESULT.EXHAUSTED:
      throw new HttpsError('resource-exhausted', 'Too many attempts. Request a new code.');
    case VERIFY_RESULT.ALREADY_USED:
      throw new HttpsError('failed-precondition', 'That code has already been used.');
    case VERIFY_RESULT.NOT_FOUND:
    default:
      throw new HttpsError('permission-denied', 'That code is incorrect or has expired.');
  }

  const email = outcome.email;

  // Get-or-create a real Firebase Auth user for this email. Doing it this
  // way (rather than inventing a uid) means the Auth record's `email`
  // field is set properly, which is what firestore.rules' vedaAccount()
  // check reads from request.auth.token.email -- unchanged from the
  // Microsoft sign-in path.
  let uid;
  try {
    const existing = await admin.auth().getUserByEmail(email);
    uid = existing.uid;
  } catch (err) {
    if (err.code !== 'auth/user-not-found') throw err;
    const created = await admin.auth().createUser({ email, emailVerified: true });
    uid = created.uid;
  }

  const token = await admin.auth().createCustomToken(uid, { email });
  return { token };
});
