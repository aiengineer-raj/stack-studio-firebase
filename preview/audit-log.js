/**
 * Audit log for Stack Studio.
 *
 * Ported from the earlier Node/SQLite backend's auditLog.js, which had this
 * right: a design calculation that someone signs off on should carry a
 * record of who opened it, who changed it, and when. Firebase Auth logs
 * sign-ins, but it knows nothing about DESIGNS — so without this, there is
 * no answer to "who last touched the Kandla chimney and when".
 *
 * Two deliberate carry-overs from that original module:
 *
 *   1. It cannot record a secret, BY CONSTRUCTION. The original never
 *      accepted an OTP as a parameter, so it could not leak one even by
 *      mistake. Same discipline here: this module takes an event type, a
 *      design id and a small detail object — it never takes a design's
 *      full input payload, so a whole calculation can't accidentally end
 *      up duplicated into the log.
 *
 *   2. Failures are swallowed, never thrown. An audit write must never be
 *      the reason an engineer loses work. If logging breaks, the save still
 *      succeeds and the console gets a warning.
 *
 * WHAT THIS IS NOT: it is not tamper-proof. The rules below let a signed-in
 * user append entries and read their own; they cannot edit or delete any.
 * That stops casual rewriting of history, not a determined project owner
 * with console access — anyone who can change the security rules can change
 * anything. For a genuinely tamper-evident trail you would write these from
 * a Cloud Function with the client denied write access entirely, which
 * needs the Blaze plan. Worth knowing the difference rather than assuming
 * more than it gives you.
 */

import {
  collection, addDoc, query, where, orderBy, limit as fsLimit, getDocs,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { db } from './firebase-init.js';

const COLLECTION = 'auditLog';

/**
 * The event types this app records. Kept as a closed list — matching the
 * original backend's approach — so the log stays queryable instead of
 * filling with ad-hoc strings that nobody can filter on later.
 */
export const AUDIT = {
  DESIGN_CREATED: 'design_created',
  DESIGN_UPDATED: 'design_updated',
  DESIGN_OPENED: 'design_opened',
  DESIGN_DELETED: 'design_deleted',
  DESIGN_SHARED: 'design_shared',
  DESIGN_UNSHARED: 'design_unshared',
  REPORT_EXPORTED: 'report_exported',
};

/**
 * Appends one entry. Never throws.
 *
 * `detail` is for small, factual context only — a design name, a revision
 * label, a count. Do NOT pass a whole DesignInput here: the design document
 * already holds it, and duplicating it into the log wastes space and makes
 * the log unreadable.
 */
export async function logAuditEvent(eventType, user, { designId = null, detail = null } = {}) {
  if (!user) return;
  try {
    await addDoc(collection(db, COLLECTION), {
      eventType: eventType,
      actorUid: user.uid,
      actorEmail: user.email,
      actorName: user.name,
      tool: 'stack-studio',
      designId: designId,
      detail: detail,
      at: serverTimestamp(),
    });
  } catch (err) {
    // Deliberately swallowed — see the module header. An engineer must not
    // lose a save because the audit write failed.
    console.warn('Audit log write failed (continuing):', err && err.message);
  }
}

/**
 * The history of one design, newest first.
 *
 * Needs a composite index on (designId ASC, at DESC) — Firestore prints a
 * one-click link to create it the first time this runs.
 */
export async function designHistory(designId, { max = 50 } = {}) {
  const q = query(
    collection(db, COLLECTION),
    where('designId', '==', designId),
    orderBy('at', 'desc'),
    fsLimit(max),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const v = d.data();
    return {
      id: d.id,
      eventType: v.eventType,
      actorName: v.actorName,
      actorEmail: v.actorEmail,
      detail: v.detail,
      at: v.at && v.at.toDate ? v.at.toDate() : null,
    };
  });
}

/** Plain-English labels for showing history in the UI. */
export function describeEvent(entry) {
  const who = entry.actorName || entry.actorEmail || 'Someone';
  switch (entry.eventType) {
    case AUDIT.DESIGN_CREATED:  return who + ' created this design';
    case AUDIT.DESIGN_UPDATED:  return who + ' saved changes';
    case AUDIT.DESIGN_OPENED:   return who + ' opened it';
    case AUDIT.DESIGN_DELETED:  return who + ' deleted it';
    case AUDIT.DESIGN_SHARED:   return who + ' shared it with Veda';
    case AUDIT.DESIGN_UNSHARED: return who + ' made it private again';
    case AUDIT.REPORT_EXPORTED: return who + ' exported the report';
    default:                    return who + ' — ' + entry.eventType;
  }
}
