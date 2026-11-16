/**
 * Bridges the ES-module Firebase code (auth.js, cloud-designs.js) into the
 * classic, non-module <script> that app.js runs as.
 *
 * WHY THIS FILE EXISTS: app.js is inlined as a plain <script> block by
 * build.mjs (not type="module"), so it cannot use `import` directly, and
 * mixing module syntax into it would risk everything else in that 2,800-line
 * file that assumes classic-script, global-scope behaviour. Rather than
 * risk that, this one small file does the importing, and exposes exactly
 * what app.js needs on `window` -- a narrow, deliberate bridge instead of
 * merging two different script models together.
 *
 * ORDERING, which matters and is easy to get backwards: <script
 * type="module"> is ALWAYS deferred -- it runs after the document has been
 * parsed, regardless of where the tag sits in the HTML. app.js's classic
 * script runs immediately, inline, as the parser reaches it. So by the time
 * THIS file's top-level code runs, app.js has already finished its initial,
 * synchronous run and has already defined `window.onFirebaseAuthChange`
 * (see the wiring in app.js). That is why app.js must never expect
 * `window.StackStudioCloud` to exist at its own top level -- only inside
 * event handlers and inside the onFirebaseAuthChange callback, both of
 * which fire later, after this module has had time to run.
 */

import { watchAuth, requestCode, verifyCode, signOut } from './auth.js';
import * as Cloud from './cloud-designs.js';

window.StackStudioAuth = { requestCode, verifyCode, signOut };
window.StackStudioCloud = Cloud;

watchAuth(function (user) {
  Cloud.setUser(user);
  // app.js defines this once its own script body has run. Guard against it
  // somehow not existing yet -- defensive, not expected in practice given
  // the ordering above, but a silent no-op here is better than a thrown
  // error breaking auth state changes for every future sign-in.
  if (typeof window.onFirebaseAuthChange === 'function') {
    window.onFirebaseAuthChange(user);
  }
});
