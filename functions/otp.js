/**
 * OTP generation and verification, on Firestore.
 *
 * Ported directly from the earlier Node/SQLite backend's src/otp.js, which
 * was already built carefully and had 18 passing tests behind it. The
 * constants, the bcrypt cost factor, and — most importantly — the exact
 * state machine in verify() are unchanged. Only the storage calls differ
 * (Firestore reads/writes instead of SQL), because getting security-bearing
 * logic like this right once and then re-deriving it from scratch a second
 * time is how subtle bugs get reintroduced.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes
const MAX_ATTEMPTS = 5;
const BCRYPT_COST = 12;             // deliberately slow -- see the original
                                     // backend's note: the 1,000,000-value
                                     // space is small, so hash strength
                                     // matters if the store is ever read
                                     // directly, even though live brute-force
                                     // is actually stopped by the attempt
                                     // limit and rate limiting, not hash speed.

function generateOtp() {
  // crypto.randomInt is CSPRNG-backed -- never Math.random() for this.
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

function hashOtp(otp) {
  return bcrypt.hashSync(otp, BCRYPT_COST);
}

/**
 * Creates a new OTP request document. Returns the PLAINTEXT otp (for the
 * caller to email -- this function never stores it) and the request id the
 * client must echo back on verify.
 */
async function createOtpRequest(db, email, ipAddress) {
  const id = crypto.randomUUID();
  const otp = generateOtp();
  const now = Date.now();
  await db.collection('otp_requests').doc(id).set({
    email,
    otpHash: hashOtp(otp),
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    consumed: false,
    ipAddress: ipAddress || null,
  });
  return { id, otp, expiresAt: now + OTP_TTL_MS };
}

const VERIFY_RESULT = Object.freeze({
  OK: 'ok',
  NOT_FOUND: 'not_found',
  ALREADY_USED: 'already_used',
  EXPIRED: 'expired',
  EXHAUSTED: 'exhausted',
  INCORRECT: 'incorrect',
});

/**
 * Verifies a submitted code against a request id.
 *
 * Same state machine as the original: every branch that ends the request's
 * usability (success, expiry discovered here, or hitting the attempt limit)
 * marks it consumed in the SAME transaction that reads it, so a request can
 * never be verified twice even under concurrent submissions. Firestore
 * transactions give the same atomicity guarantee the original got from a
 * SQLite transaction.
 */
async function verifyOtp(db, requestId, submittedOtp) {
  const ref = db.collection('otp_requests').doc(requestId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { result: VERIFY_RESULT.NOT_FOUND };
    const row = snap.data();

    if (row.consumed) return { result: VERIFY_RESULT.ALREADY_USED };

    if (Date.now() > row.expiresAt) {
      tx.update(ref, { consumed: true });
      return { result: VERIFY_RESULT.EXPIRED };
    }

    if (row.attempts >= row.maxAttempts) {
      tx.update(ref, { consumed: true });
      return { result: VERIFY_RESULT.EXHAUSTED };
    }

    const correct = bcrypt.compareSync(submittedOtp, row.otpHash);
    if (!correct) {
      const attempts = row.attempts + 1;
      const nowExhausted = attempts >= row.maxAttempts;
      tx.update(ref, { attempts, consumed: nowExhausted });
      return { result: nowExhausted ? VERIFY_RESULT.EXHAUSTED : VERIFY_RESULT.INCORRECT };
    }

    tx.update(ref, { consumed: true, attempts: row.attempts + 1 });
    return { result: VERIFY_RESULT.OK, email: row.email };
  });
}

module.exports = { generateOtp, hashOtp, createOtpRequest, verifyOtp, VERIFY_RESULT, OTP_TTL_MS, MAX_ATTEMPTS };
