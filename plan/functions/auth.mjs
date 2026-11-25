import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_ADMINS = new Set([
  'raj.patil@vedaengg.com',
  'rohit.hotkar@vedaengg.com',
]);

export function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

export function emailOf(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._+-]{0,63}@vedaengg\.com$/.test(email)) {
    fail(400, 'Use your @vedaengg.com work email.');
  }
  return email;
}

export function displayNameFromEmail(email) {
  return email
    .split('@')[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export const hash = (value) => createHash('sha256').update(value).digest('hex');

export const otpDigest = (secret, email, challenge, code) =>
  createHmac('sha256', secret).update(`${email}\n${challenge}\n${code}`).digest('hex');

export function checkOtp(record, { email, challenge, code, secret, now }) {
  if (
    !record ||
    record.challenge !== challenge ||
    !record.delivered ||
    record.used ||
    record.expiresAt <= now ||
    record.attempts >= 5
  ) {
    return { ok: false, error: 'Code expired or unavailable. Request a new code.' };
  }
  const expected = Buffer.from(record.digest, 'hex');
  const given = Buffer.from(otpDigest(secret, email, challenge, code), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, attempts: record.attempts + 1, error: 'Incorrect code.' };
  }
  return { ok: true };
}

function deriveJwtSecret(pepper) {
  return createHmac('sha256', pepper).update('forgeplan-mes-jwt-v1').digest();
}

export function signSessionToken(user, pepper, ttlSeconds = 60 * 60 * 24 * 7) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      department: user.department || '',
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    })
  ).toString('base64url');
  const sig = createHmac('sha256', deriveJwtSecret(pepper))
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export function verifySessionToken(token, pepper) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expectedSig = createHmac('sha256', deriveJwtSecret(pepper))
      .update(`${header}.${payload}`)
      .digest();
    const givenSig = Buffer.from(sig, 'base64url');
    if (expectedSig.length !== givenSig.length || !timingSafeEqual(expectedSig, givenSig)) {
      return null;
    }
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded || typeof decoded.exp !== 'number' || decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
