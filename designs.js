/**
 * Saved designs, backed by Firestore.
 *
 * Deliberately stores the SAME payload the app's existing file export
 * produces (Engine.toFile / Engine.fromFile). That means a design saved to
 * the cloud and a design saved to disk are the same shape, so the existing
 * version-migration logic in persistence.ts keeps working, and a cloud
 * design can still be downloaded as a file later. Inventing a second,
 * cloud-only format here would have split that in two.
 *
 * One document per design, in the `designs` collection:
 *   ownerUid   - who owns it (enforced by firestore.rules, not just set here)
 *   ownerName  - display name, so a shared design shows who prepared it
 *   tool       - 'stack-studio' | 'tankforge-650'; both tools share this
 *                collection, so every query MUST filter on it
 *   name       - the design's label, shown in the list
 *   shared     - false by default; true lets the rest of Veda read it
 *   payload    - the Engine.toFile() object, stored as-is
 *   createdAt / updatedAt - server timestamps, not client clocks
 */

import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

import { db } from './firebase-init.js';

const COLLECTION = 'designs';
export const TOOL_ID = 'stack-studio';

/**
 * Saves a new design. `payload` should be Engine.toFile(input, name).
 * Returns the new document id.
 */
export async function createDesign(user, name, payload, { shared = false } = {}) {
  const ref = await addDoc(collection(db, COLLECTION), {
    ownerUid: user.uid,
    ownerName: user.name,
    tool: TOOL_ID,
    name: name,
    shared: shared,
    payload: payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Overwrites an existing design the caller owns. */
export async function updateDesign(designId, { name, payload, shared }) {
  const patch = { updatedAt: serverTimestamp() };
  if (name !== undefined) patch.name = name;
  if (payload !== undefined) patch.payload = payload;
  if (shared !== undefined) patch.shared = shared;
  await setDoc(doc(db, COLLECTION, designId), patch, { merge: true });
}

export async function deleteDesign(designId) {
  await deleteDoc(doc(db, COLLECTION, designId));
}

export async function loadDesign(designId) {
  const snap = await getDoc(doc(db, COLLECTION, designId));
  if (!snap.exists()) throw new Error('That design no longer exists.');
  return { id: snap.id, ...snap.data() };
}

/**
 * The caller's own designs, newest first.
 *
 * NOTE: `where(tool) + where(ownerUid) + orderBy(updatedAt)` needs a
 * composite index. Firestore will refuse the query and print a console link
 * that creates the exact index in one click — follow it the first time you
 * run this; it is expected, not a bug.
 */
export async function listMyDesigns(user) {
  const q = query(
    collection(db, COLLECTION),
    where('tool', '==', TOOL_ID),
    where('ownerUid', '==', user.uid),
    orderBy('updatedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Designs other people at Veda have chosen to share.
 *
 * Filters the caller's own out client-side so the list reads as "shared with
 * me" rather than repeating things already in "My designs". Firestore has no
 * `!=` that composes cleanly with the other filters here, so this one small
 * filter genuinely belongs on the client — it is a presentation choice, and
 * the rules still enforce that only `shared == true` documents are readable
 * at all.
 */
export async function listSharedDesigns(user) {
  const q = query(
    collection(db, COLLECTION),
    where('tool', '==', TOOL_ID),
    where('shared', '==', true),
    orderBy('updatedAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => d.ownerUid !== user.uid);
}
