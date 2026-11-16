/**
 * Cloud adapter for the design library.
 *
 * The app ALREADY has a full library UI (renderLibrary in app.js) backed by
 * Engine.listDesigns / openDesign / deleteDesign, which use localStorage.
 * Rather than build a second, parallel "cloud designs" panel, this adapter
 * presents the SAME interface against Firestore, so the existing UI works
 * with almost no change to it:
 *
 *   Engine.listDesigns()        -> Cloud.listDesigns()        (async)
 *   Engine.saveDesign(i, name)  -> Cloud.saveDesign(i, name)  (async)
 *   Engine.openDesign(id)       -> Cloud.openDesign(id)       (async)
 *   Engine.deleteDesign(id)     -> Cloud.deleteDesign(id)     (async)
 *
 * The one real difference is async: every call returns a Promise, because a
 * network round-trip cannot be faked as synchronous. app.js has to await
 * them — see the wiring notes at the bottom of this file.
 *
 * DELIBERATE: localStorage is NOT removed. It stays as the offline/guest
 * path and as a fallback if Firestore is unreachable. A user who is not
 * signed in still gets the tool, still gets local saves — they just do not
 * get cloud sync. Losing the ability to work offline would be a real
 * regression, not an upgrade.
 */

import {
  createDesign, updateDesign, deleteDesign as fsDelete,
  loadDesign, listMyDesigns, listSharedDesigns,
} from './designs.js';

import { logAuditEvent, AUDIT } from './audit-log.js';

/** Set by app.js whenever auth state changes. null = not signed in. */
let currentUser = null;

export function setUser(user) { currentUser = user; }
export function isSignedIn() { return currentUser !== null; }

/**
 * Maps a Firestore document to the exact LibraryEntry shape the existing
 * renderLibrary() already knows how to draw, plus two extra fields it can
 * use if present (ownerName, shared) and ignore otherwise.
 */
function toLibraryEntry(doc) {
  const input = doc.payload && doc.payload.input ? doc.payload.input : null;
  return {
    id: doc.id,
    name: doc.name,
    // Firestore timestamps are objects, not ISO strings. Normalise so the
    // existing `new Date(d.savedAt)` in renderLibrary keeps working.
    savedAt: doc.updatedAt && doc.updatedAt.toDate
      ? doc.updatedAt.toDate().toISOString()
      : new Date().toISOString(),
    summary: input ? {
      height: input.geometry.totalHeight,
      topId: input.geometry.topId,
      flareBottomId: input.geometry.flareBottomId,
      site: input.project.site,
    } : { height: 0, topId: 0, flareBottomId: 0, site: '' },
    ownerName: doc.ownerName,
    shared: doc.shared === true,
    mine: currentUser ? doc.ownerUid === currentUser.uid : false,
  };
}

/**
 * Everything the signed-in user can see: their own designs first, then the
 * ones colleagues have shared. Sorted newest-first within each group so the
 * user's own recent work is always at the top.
 */
export async function listDesigns() {
  if (!currentUser) return [];
  const [mine, shared] = await Promise.all([
    listMyDesigns(currentUser),
    listSharedDesigns(currentUser),
  ]);
  return [...mine.map(toLibraryEntry), ...shared.map(toLibraryEntry)];
}

/**
 * Saves under the given name. If a design the user OWNS already carries
 * that exact name, it is updated rather than duplicated — matching the
 * local library's name-keyed behaviour, so pressing Save twice does not
 * quietly leave two copies behind.
 */
export async function saveDesign(input, name, toFilePayload) {
  if (!currentUser) throw new Error('Sign in to save to the cloud.');
  const mine = await listMyDesigns(currentUser);
  const existing = mine.find((d) => d.name === name);
  if (existing) {
    await updateDesign(existing.id, { payload: toFilePayload });
    await logAuditEvent(AUDIT.DESIGN_UPDATED, currentUser,
      { designId: existing.id, detail: { name: name } });
    return existing.id;
  }
  const newId = await createDesign(currentUser, name, toFilePayload);
  await logAuditEvent(AUDIT.DESIGN_CREATED, currentUser,
    { designId: newId, detail: { name: name } });
  return newId;
}

/**
 * Returns the raw file payload. app.js passes this through Engine.fromFile()
 * exactly as it does for an uploaded file, so the same defensive
 * version-migration path runs for cloud designs — a design saved by an older
 * build still opens, and still reports what it had to repair.
 */
export async function openDesign(id) {
  const doc = await loadDesign(id);
  await logAuditEvent(AUDIT.DESIGN_OPENED, currentUser,
    { designId: id, detail: { name: doc.name, ownerName: doc.ownerName } });
  return doc.payload;
}

export async function deleteDesign(id) {
  if (!currentUser) throw new Error('Sign in to delete cloud designs.');
  const doc = await loadDesign(id);
  if (doc.ownerUid !== currentUser.uid) {
    // The rules would refuse this anyway; failing here gives a clear message
    // instead of an opaque permission error from Firestore.
    throw new Error('That design belongs to ' + (doc.ownerName || 'someone else') +
                    '. You can only delete your own.');
  }
  // Logged BEFORE the delete: once the document is gone its name is gone
  // too, and "someone deleted something, unknown what" is a useless entry.
  await logAuditEvent(AUDIT.DESIGN_DELETED, currentUser,
    { designId: id, detail: { name: doc.name } });
  await fsDelete(id);
}

/** Flips a design between private and shared-with-Veda. Owner only. */
export async function setShared(id, shared) {
  if (!currentUser) throw new Error('Sign in first.');
  const doc = await loadDesign(id);
  if (doc.ownerUid !== currentUser.uid) {
    throw new Error('Only the owner can share or unshare a design.');
  }
  await updateDesign(id, { shared: shared });
  await logAuditEvent(shared ? AUDIT.DESIGN_SHARED : AUDIT.DESIGN_UNSHARED,
    currentUser, { designId: id, detail: { name: doc.name } });
}

/* ────────────────────────────────────────────────────────────────────────
 * WIRING NOTES for app.js
 *
 * 1. Import near the top of app.js (it must become type="module", or load
 *    this as a separate module that assigns window.Cloud):
 *
 *      import * as Cloud from './cloud-designs.js';
 *      import { watchAuth, signInWithMicrosoft, signOut } from './auth.js';
 *
 * 2. Replace the stub signIn() (currently writes a typed name to
 *    localStorage) with the real one:
 *
 *      $('#su-go').onclick = async function (e) {
 *        e.preventDefault();
 *        try { await signInWithMicrosoft(); }
 *        catch (err) { alert(err.message); }
 *      };
 *
 *    and let watchAuth drive the transition into the app, so a restored
 *    session on page load takes the same path as a fresh sign-in:
 *
 *      watchAuth(function (user) {
 *        Cloud.setUser(user);
 *        if (user) enterApp(user);       // the existing site-fade + render
 *      });
 *
 * 3. renderLibrary() becomes async, and picks its source by sign-in state:
 *
 *      async function renderLibrary() {
 *        var items = Cloud.isSignedIn()
 *          ? await Cloud.listDesigns()
 *          : Engine.listDesigns();       // offline / guest fallback
 *        ...unchanged drawing code...
 *      }
 *
 *    Add `await` at its three call sites, and mark the Open/Delete handlers
 *    async the same way.
 *
 * 4. Save, in the existing save handler:
 *
 *      var payload = Engine.toFile(STATE.input, STATE.designName);
 *      if (Cloud.isSignedIn()) await Cloud.saveDesign(STATE.input, STATE.designName, payload);
 *      else Engine.saveDesign(STATE.input, STATE.designName);
 *
 * 5. Open, reusing the existing migration path unchanged:
 *
 *      var payload = await Cloud.openDesign(d.id);
 *      loadOutcome(Engine.fromFile(JSON.stringify(payload)), 'the cloud library');
 *
 * 6. In each library row, show d.ownerName when d.mine is false, and a
 *    Share/Unshare toggle when it is true. Keep Delete hidden on rows the
 *    user does not own — the rules already refuse it, but the button should
 *    not be there to press.
 * ──────────────────────────────────────────────────────────────────────── */
