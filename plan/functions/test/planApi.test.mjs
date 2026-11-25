import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createPlanHandler } from '../handler.mjs';
import { createPlanStore } from '../store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, '..', 'seed', 'Manufacturing_Monthly_Plan_Improved.xlsx');

function createMockFirestore() {
  const data = new Map();

  function applyFieldUpdates(existing, patch) {
    const out = structuredClone(existing || {});
    for (const [k, v] of Object.entries(patch)) {
      if (k.includes('.')) {
        const parts = k.split('.');
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) {
          cur[parts[i]] = structuredClone(cur[parts[i]] || {});
          cur = cur[parts[i]];
        }
        cur[parts[parts.length - 1]] = structuredClone(v);
      } else {
        out[k] = structuredClone(v);
      }
    }
    return out;
  }

  function makeDocRef(docPath) {
    return {
      id: docPath.split('/').pop(),
      path: docPath,
      collection: (sub) => makeColRef(`${docPath}/${sub}`),
      async get() {
        const val = data.get(docPath);
        return {
          id: docPath.split('/').pop(),
          exists: val !== undefined,
          data: () => (val !== undefined ? structuredClone(val) : undefined),
        };
      },
      async set(val) {
        data.set(docPath, structuredClone(val));
      },
      async update(patch) {
        if (!data.has(docPath)) throw new Error(`Missing doc: ${docPath}`);
        data.set(docPath, applyFieldUpdates(data.get(docPath), patch));
      },
      async delete() {
        data.delete(docPath);
      },
    };
  }

  function makeColRef(colPath) {
    return {
      doc: (id) => makeDocRef(`${colPath}/${id}`),
      async get() {
        const prefix = `${colPath}/`;
        const docs = [];
        for (const [k, v] of data.entries()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes('/')) {
            const id = k.slice(prefix.length);
            docs.push({
              id,
              exists: true,
              data: () => structuredClone(v),
            });
          }
        }
        return { docs };
      },
    };
  }

  return {
    collection: (name) => makeColRef(name),
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, val) => staged.push(() => ref.set(val)),
        update: (ref, patch) => staged.push(() => ref.update(patch)),
        delete: (ref) => staged.push(() => ref.delete()),
      };
      const result = await fn(tx);
      for (const op of staged) await op();
      return result;
    },
  };
}

function callApi(handler, { method = 'GET', path: reqPath, body, token, origin = 'https://veplworks-plan.web.app' }) {
  return new Promise((resolve) => {
    const headers = new Map();
    const res = {
      statusCode: 200,
      set(k, v) {
        headers.set(k.toLowerCase(), v);
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, headers, body: payload });
      },
      send(raw) {
        resolve({ status: this.statusCode, headers, raw });
      },
    };
    handler(
      {
        method,
        path: reqPath,
        url: reqPath,
        ip: '127.0.0.1',
        headers: {
          origin,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body,
      },
      res
    );
  });
}

test('ForgePlan MES Firebase handler: OTP auth, Excel seed, RBAC, CRUD & 2-way Excel sync', async () => {
  const db = createMockFirestore();
  const seedBuf = fs.readFileSync(SEED_PATH);
  const store = createPlanStore(db, () => seedBuf);

  const sentEmails = [];
  const handler = createPlanHandler({
    db,
    store,
    getPepper: () => 'test-pepper-secret-32-bytes-minimum',
    getResendKey: () => 're_test_key',
    getEmailFrom: () => 'VEPL Monthly Plan <login@veplworks.com>',
    getAllowedOrigins: () => new Set(['https://veplworks-plan.web.app', 'https://plan.veplworks.com']),
    getSeedBuffer: () => seedBuf,
    sendEmailFetch: async (_url, opts) => {
      const parsed = JSON.parse(opts.body);
      const codeMatch = /code is (\d{6})/.exec(parsed.text);
      sentEmails.push({ to: parsed.to[0], code: codeMatch?.[1] });
      return { ok: true, json: async () => ({ id: 'msg_1' }), headers: new Map() };
    },
  });

  // 1. Health check
  const health = await callApi(handler, { path: '/api/health' });
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  // 2. Reject non-@vedaengg.com email
  const badEmail = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/request-code',
    body: { email: 'someone@gmail.com' },
  });
  assert.equal(badEmail.status, 400);

  // 3. Reject disallowed origin
  const badOrigin = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/request-code',
    origin: 'https://evil.example.com',
    body: { email: 'raj.patil@vedaengg.com' },
  });
  assert.equal(badOrigin.status, 403);

  // 4. Request & verify OTP for default admin (raj.patil@vedaengg.com)
  const reqOtp = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/request-code',
    body: { email: 'raj.patil@vedaengg.com' },
  });
  assert.equal(reqOtp.status, 200);
  assert.equal(sentEmails.length, 1);

  const verifyAdmin = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/verify-code',
    body: {
      email: 'raj.patil@vedaengg.com',
      challenge: reqOtp.body.challenge,
      code: sentEmails[0].code,
    },
  });
  assert.equal(verifyAdmin.status, 200);
  assert.equal(verifyAdmin.body.user.role, 'admin');
  const adminToken = verifyAdmin.body.token;

  // Replay of used OTP must fail
  const replay = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/verify-code',
    body: {
      email: 'raj.patil@vedaengg.com',
      challenge: reqOtp.body.challenge,
      code: sentEmails[0].code,
    },
  });
  assert.equal(replay.status, 401);

  // 5. Verify workspace seeded from Manufacturing_Monthly_Plan_Improved.xlsx
  const ws = await callApi(handler, { path: '/api/workspace', token: adminToken });
  assert.equal(ws.status, 200);
  assert.equal(ws.body.projects.length, 49);
  assert.equal(ws.body.otmItems.length, 101);
  assert.equal(ws.body.dailyLogs.length, 335);

  // 6. First-time shop-floor staff OTP defaults to supervisor & enforces RBAC
  const reqStaff = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/request-code',
    body: { email: 'shop.engineer@vedaengg.com' },
  });
  assert.equal(reqStaff.status, 200);
  const verifyStaff = await callApi(handler, {
    method: 'POST',
    path: '/api/auth/verify-code',
    body: {
      email: 'shop.engineer@vedaengg.com',
      challenge: reqStaff.body.challenge,
      code: sentEmails[1].code,
    },
  });
  assert.equal(verifyStaff.status, 200);
  assert.equal(verifyStaff.body.user.role, 'supervisor');
  const staffToken = verifyStaff.body.token;

  // Supervisor can log daily work, cannot add project
  const forbiddenProj = await callApi(handler, {
    method: 'POST',
    path: '/api/projects',
    token: staffToken,
    body: { project_no: 'V99 9999', customer_name: 'Test', project_status: 'Active' },
  });
  assert.equal(forbiddenProj.status, 403);

  const dailyAdd = await callApi(handler, {
    method: 'POST',
    path: '/api/daily-logs',
    token: staffToken,
    body: {
      log_date: '2026-11-25',
      project_no: ws.body.otmItems[0].project_no,
      item_description: ws.body.otmItems[0].item_description,
      work_done_today: 'Fit-up & tack welding completed',
      status: 'Done',
    },
  });
  assert.equal(dailyAdd.status, 200);

  // Admin upgrades staff role to planner -> immediate effect without re-login
  const upgrade = await callApi(handler, {
    method: 'PUT',
    path: `/api/users/${verifyStaff.body.user.id}`,
    token: adminToken,
    body: { role: 'planner' },
  });
  assert.equal(upgrade.status, 200);
  assert.equal(upgrade.body.user.role, 'planner');

  const otmAdd = await callApi(handler, {
    method: 'POST',
    path: '/api/otm',
    token: staffToken,
    body: {
      project_no: ws.body.projects[0].project_no,
      item_description: 'Chimney Base Cone Shell',
      wt_drawing_kg: 4200,
      fabrication_location: 'Shop',
      plan_start: '2026-11-01',
      plan_end: '2026-11-20',
    },
  });
  assert.equal(otmAdd.status, 200);

  // 7. Export Excel (.xlsx) & re-import in merge mode
  const exported = await callApi(handler, {
    path: '/api/excel/export?asOfDate=2026-11-25',
    token: adminToken,
  });
  assert.equal(exported.status, 200);
  assert.ok(Buffer.isBuffer(exported.raw) && exported.raw.length > 20000);

  const reimport = await callApi(handler, {
    method: 'POST',
    path: '/api/excel/import',
    token: staffToken,
    body: {
      fileName: 'Exported_Roundtrip.xlsx',
      fileBase64: exported.raw.toString('base64'),
      mode: 'merge',
    },
  });
  assert.equal(reimport.status, 200);
  assert.equal(reimport.body.summary.otmItems, 102);
});
