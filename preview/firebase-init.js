/**
 * Firebase initialisation for Stack Studio.
 *
 * Loaded as an ES module from the Firebase CDN — no build step, no bundler,
 * matching how the rest of this app is delivered (one static file plus a few
 * scripts). Firebase Hosting serves the whole thing.
 *
 * THE VALUES BELOW ARE NOT SECRETS. A Firebase web config is designed to ship
 * in client code and is visible to anyone who opens devtools. What actually
 * protects your data is the Firestore security rules (firestore.rules) plus
 * the auth restriction in auth.js — not hiding this config. Do not let anyone
 * talk you into "securing" it by obfuscation; secure the rules instead.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBwhs0SKwDx0kHW8B4pPPa7LHQYJFXB9E4',
  authDomain: 'veplworks.firebaseapp.com',
  projectId: 'veplworks',
  storageBucket: 'veplworks.firebasestorage.app',
  messagingSenderId: '981736890817',
  appId: '1:981736890817:web:eab399fb355eedad23cf40',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

/**
 * The domain every Veda account carries.
 *
 * With OTP sign-in, this is not a "belt-and-braces backstop" the way it
 * would be alongside an identity-provider restriction -- there is no
 * separate hard boundary at a provider here. This value drives the actual
 * restriction: Cloud Functions' requestOtp checks it before ever
 * generating or emailing a code (see functions/index.js), and
 * firestore.rules checks it again at the database. It is duplicated in
 * THREE places for that reason -- this file, functions/index.js, and
 * firestore.rules -- because none of those three can import a shared
 * constant from either of the others (they run in different environments:
 * browser, Cloud Functions' Node/Admin SDK, and the Firestore rules
 * engine, respectively). If this domain ever changes again, all three
 * need updating together.
 */
export const ALLOWED_EMAIL_DOMAIN = 'vedaengg.com';
