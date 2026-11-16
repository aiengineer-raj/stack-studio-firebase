/**
 * Rate limiting, ported from the earlier backend's src/rateLimit.js.
 *
 * Same three limits, same reasoning, only the storage differs:
 *   - a 60s cooldown between requests for the same email (stops "spam the
 *     resend button")
 *   - max 3 requests per email per 15 minutes
 *   - max 10 requests per IP per 15 minutes -- looser and separate from the
 *     per-email limit, because an IP is not necessarily one person (NAT,
 *     shared office network), so this exists to catch bulk/scripted abuse
 *     across many different email addresses, not to double-penalise one
 *     legitimate user already covered by their own limit.
 *
 * Checked BEFORE any OTP is generated, hashed or emailed -- rate limiting
 * exists specifically to stop that work from running in a loop, so it has
 * to run first, not after.
 */

const RESEND_COOLDOWN_MS = 60 * 1000;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_MAX_REQUESTS = 3;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_REQUESTS = 10;

const RATE_LIMIT_REASON = Object.freeze({
  COOLDOWN: 'cooldown',
  EMAIL_LIMIT: 'email_limit',
  IP_LIMIT: 'ip_limit',
});

/** Returns null if the request is allowed, or a reason string if blocked. */
async function checkRateLimit(db, email, ipAddress) {
  const now = Date.now();
  const events = db.collection('rate_limit_events');

  const lastForEmailSnap = await events
    .where('scope', '==', 'email')
    .where('keyValue', '==', email)
    .orderBy('requestedAt', 'desc')
    .limit(1)
    .get();
  if (!lastForEmailSnap.empty) {
    const last = lastForEmailSnap.docs[0].data().requestedAt;
    if (now - last < RESEND_COOLDOWN_MS) return RATE_LIMIT_REASON.COOLDOWN;
  }

  const emailCountSnap = await events
    .where('scope', '==', 'email')
    .where('keyValue', '==', email)
    .where('requestedAt', '>', now - EMAIL_WINDOW_MS)
    .get();
  if (emailCountSnap.size >= EMAIL_MAX_REQUESTS) return RATE_LIMIT_REASON.EMAIL_LIMIT;

  if (ipAddress) {
    const ipCountSnap = await events
      .where('scope', '==', 'ip')
      .where('keyValue', '==', ipAddress)
      .where('requestedAt', '>', now - IP_WINDOW_MS)
      .get();
    if (ipCountSnap.size >= IP_MAX_REQUESTS) return RATE_LIMIT_REASON.IP_LIMIT;
  }

  return null;
}

/** Records that a request attempt happened, whatever the outcome, so the
 *  cooldown/window counts stay accurate regardless. */
async function recordRateLimitEvent(db, email, ipAddress) {
  const now = Date.now();
  const batch = db.batch();
  const events = db.collection('rate_limit_events');
  batch.set(events.doc(), { scope: 'email', keyValue: email, requestedAt: now });
  if (ipAddress) {
    batch.set(events.doc(), { scope: 'ip', keyValue: ipAddress, requestedAt: now });
  }
  await batch.commit();
}

module.exports = { checkRateLimit, recordRateLimitEvent, RATE_LIMIT_REASON };
