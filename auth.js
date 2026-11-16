/**
 * Authentication for Stack Studio, on email OTP.
 *
 * Replaces the earlier Microsoft/Entra sign-in with a one-time-code-by-email
 * flow. The actual OTP generation, hashing, verification, rate limiting and
 * emailing all happen in Cloud Functions (functions/index.js) -- none of it
 * is safe to run in the browser, since a client can never be trusted to
 * grade its own answer.
 *
 * What this file does is thin by design: call requestOtp, call verifyOtp,
 * and on success exchange the returned custom token for a real Firebase
 * Auth session. Everything downstream of that (firestore.rules,
 * cloud-designs.js, audit-log.js) is UNCHANGED from the Microsoft version --
 * they all key off request.auth / auth.currentUser, not off which sign-in
 * method produced it.
 */

import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import {
  signInWithCustomToken,
  signOut as fbSignOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import { app, auth, ALLOWED_EMAIL_DOMAIN } from './firebase-init.js';

const functions = getFunctions(app);
const callRequestOtp = httpsCallable(functions, 'requestOtp');
const callVerifyOtp = httpsCallable(functions, 'verifyOtp');

/**
 * Step 1: request a code.
 * Returns { requestId, expiresInSeconds }. Pass requestId to verifyCode.
 *
 * NOTE: this deliberately resolves the same way for an address outside
 * @vedaengg.com as for a real one that got rate-limited -- the server does
 * not tell the client which happened (see index.js). The UI copy below
 * reflects that: it can only ever say "check your email", never "that
 * address isn't allowed", because the server intentionally never says so
 * either.
 */
export async function requestCode(email) {
  const trimmed = String(email || '').trim().toLowerCase();
  if (!trimmed.includes('@')) {
    throw new Error('Enter a valid email address.');
  }
  const res = await callRequestOtp({ email: trimmed });
  return res.data; // { requestId, expiresInSeconds }
}

/**
 * Step 2: verify the code the user typed.
 * On success, exchanges the returned custom token for a real session and
 * resolves to the same { uid, name, email, role } shape the Microsoft
 * version produced -- watchAuth (below) will also fire once this completes.
 */
export async function verifyCode(requestId, code) {
  const res = await callVerifyOtp({ requestId, code: String(code || '').trim() });
  const { token } = res.data;
  const cred = await signInWithCustomToken(auth, token);
  const email = (cred.user.email || '').toLowerCase();
  return {
    uid: cred.user.uid,
    name: email.split('@')[0],
    email,
    role: '',
  };
}

export function signOut() {
  return fbSignOut(auth);
}

/**
 * Fires whenever the session changes, including once on page load with the
 * restored session (or null). A restored OTP-derived session behaves
 * exactly like a fresh Microsoft one did -- same shape, same downstream
 * behaviour.
 */
export function watchAuth(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) return callback(null);
    const email = (user.email || '').toLowerCase();
    callback({
      uid: user.uid,
      name: email.split('@')[0],
      email,
      role: '',
    });
  });
}

export { ALLOWED_EMAIL_DOMAIN };
