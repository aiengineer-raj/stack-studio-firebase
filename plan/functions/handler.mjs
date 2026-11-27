import { randomBytes, randomInt } from 'node:crypto';
import {
  checkOtp,
  emailOf,
  fail,
  hasFullAccess,
  hash,
  otpDigest,
  signSessionToken,
  verifySessionToken,
} from './auth.mjs';
import { buildExportWorkbook, parseManufacturingWorkbook } from './excelService.mjs';

function parseJsonBody(req) {
  let b = req.body;
  if (Buffer.isBuffer(b)) b = JSON.parse(b.toString('utf8'));
  if (typeof b === 'string') b = b ? JSON.parse(b) : {};
  if (b === undefined || b === null) return {};
  if (typeof b !== 'object' || Array.isArray(b)) fail(400, 'JSON object body required.');
  return b;
}

function getQueryParam(req, name) {
  if (req.query && typeof req.query[name] === 'string') return req.query[name];
  const rawUrl = req.originalUrl || req.url || '';
  const qIdx = rawUrl.indexOf('?');
  if (qIdx < 0) return '';
  return new URLSearchParams(rawUrl.slice(qIdx + 1)).get(name) || '';
}

function requireRoles(actor, ...allowed) {
  if (!actor) fail(401, 'Authentication required.');
  if (!hasFullAccess(actor.role) && !allowed.includes(actor.role)) {
    fail(
      403,
      `Access denied. Role '${actor.role}' cannot perform this action (requires: ${allowed.join(', ')}).`
    );
  }
}

export function createPlanHandler({
  db,
  store,
  getPepper,
  getResendKey,
  getEmailFrom,
  getAllowedOrigins,
  getSeedBuffer,
  sendEmailFetch = globalThis.fetch,
}) {
  const limitsCol = store.root.collection('limits');
  const otpCol = store.root.collection('otp');

  async function checkLimit(key, max, windowMs) {
    const ref = limitsCol.doc(hash(key));
    const now = Date.now();
    const allowed = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const v = s.data() || {};
      const start = v.start || 0;
      const count = now - start < windowMs ? v.count || 0 : 0;
      if (count >= max) return false;
      tx.set(ref, { start: now - start < windowMs ? start : now, count: count + 1 });
      return true;
    });
    if (!allowed) fail(429, 'Too many attempts. Please try again later.');
  }

  async function handleRequestCode(req, res) {
    const body = parseJsonBody(req);
    const email = emailOf(body.email);
    const now = Date.now();

    await checkLimit(`send-ip:${req.ip || 'unknown'}`, 20, 3600000);
    await checkLimit('send-global-day', 500, 86400000);

    const challenge = randomBytes(24).toString('hex');
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    const pepper = getPepper();
    const ref = otpCol.doc(hash(email));

    const allowed = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const old = s.data() || {};
      const count = now - (old.windowStart || 0) < 3600000 ? old.sent || 0 : 0;
      if (now - (old.lastSent || 0) < 60000 || count >= 5) return false;
      tx.set(ref, {
        challenge,
        digest: otpDigest(pepper, email, challenge, code),
        expiresAt: now + 600000,
        attempts: 0,
        used: false,
        delivered: false,
        lastSent: now,
        windowStart: count ? old.windowStart : now,
        sent: count + 1,
      });
      return true;
    });

    if (!allowed) {
      fail(429, 'Wait 60 seconds before requesting another code. Maximum five requests per hour.');
    }

    let response;
    try {
      response = await sendEmailFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getResendKey()}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `plan-otp-${challenge}`,
        },
        body: JSON.stringify({
          from: getEmailFrom(),
          to: [email],
          subject: 'Your VEPL Monthly Plan sign-in code',
          text: `Your ForgePlan MES (Monthly Production Plan) sign-in code is ${code}. It expires in 10 minutes and can be used once. If you did not request it, ignore this email.`,
        }),
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      fail(503, 'Email delivery could not be confirmed. Please try again in a minute.');
    }

    if (!response.ok) {
      let details = {};
      try {
        details = await response.json();
      } catch {
        // ignore non-json error body
      }
      const safeDetail = String(details.message || details.error || 'No error detail returned')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/re_[A-Za-z0-9_-]+/g, '[redacted-key]')
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .slice(0, 300);
      console.error('Resend rejected Monthly Plan email request', {
        status: response.status,
        code: details.name || details.code || null,
        detail: safeDetail,
      });
      fail(503, 'Email delivery is unavailable. Please try again later.');
    }

    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      if (s.data()?.challenge === challenge) {
        tx.update(ref, { delivered: true });
      }
    });

    res.status(200).json({ challenge, expiresIn: 600, resendAfter: 60 });
  }

  async function handleVerifyCode(req, res) {
    const body = parseJsonBody(req);
    const email = emailOf(body.email);
    const challenge = String(body.challenge || '');
    const code = String(body.code || '').trim();
    if (!/^[a-f0-9]{48}$/.test(challenge) || !/^\d{6}$/.test(code)) {
      fail(400, 'Enter the six-digit code from your email.');
    }

    await checkLimit(`verify-ip:${req.ip || 'unknown'}`, 100, 3600000);

    const pepper = getPepper();
    const ref = otpCol.doc(hash(email));
    const result = await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const check = checkOtp(s.data(), {
        email,
        challenge,
        code,
        secret: pepper,
        now: Date.now(),
      });
      if (check.ok) {
        tx.update(ref, { used: true, usedAt: Date.now() });
      } else if (check.attempts != null) {
        tx.update(ref, { attempts: check.attempts });
      }
      return check;
    });

    if (!result.ok) fail(401, result.error);

    const user = await store.getOrRegisterOtpUser(email);
    const token = signSessionToken(user, pepper);
    res.status(200).json({ token, user });
  }

  async function authenticate(req) {
    const authHeader = String(req.headers?.authorization || '');
    const queryToken = getQueryParam(req, 'token');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : queryToken;
    if (!token) fail(401, 'Authentication required. Please sign in.');

    const decoded = verifySessionToken(token, getPepper());
    if (!decoded || !decoded.email) {
      fail(401, 'Invalid or expired session. Please sign in again.');
    }
    const liveUser = await store.getUserByEmail(decoded.email);
    if (!liveUser) {
      fail(401, 'Your workspace access has been revoked. Contact an administrator.');
    }
    return liveUser;
  }

  return async function handleRequest(req, res) {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');

    try {
      const method = String(req.method || 'GET').toUpperCase();
      if (['POST', 'PUT', 'DELETE'].includes(method)) {
        const allowed = getAllowedOrigins();
        const reqOrigin = String(req.headers?.origin || '');
        if (allowed.size > 0 && !allowed.has(reqOrigin)) {
          fail(403, 'Request origin is not allowed.');
        }
      }

      const rawPath =
        String(req.path || req.url || '/')
          .split('?')[0]
          .replace(/^\/api/, '') || '/';

      if (method === 'GET' && rawPath === '/health') {
        return res.status(200).json({ status: 'ok', service: 'ForgePlan MES Firebase API' });
      }

      if (method === 'POST' && rawPath === '/auth/request-code') {
        return await handleRequestCode(req, res);
      }

      if (method === 'POST' && rawPath === '/auth/verify-code') {
        return await handleVerifyCode(req, res);
      }

      const actor = await authenticate(req);

      if (method === 'GET' && rawPath === '/auth/me') {
        return res.status(200).json({ user: actor });
      }

      // Users (Admin)
      if (method === 'GET' && rawPath === '/users') {
        requireRoles(actor, 'admin');
        const users = await store.listUsers();
        return res.status(200).json({ users });
      }

      if (method === 'POST' && rawPath === '/users') {
        requireRoles(actor, 'admin');
        const user = await store.upsertUser(parseJsonBody(req), actor);
        return res.status(200).json({ user });
      }

      const userMatch = /^\/users\/(\d+)$/.exec(rawPath);
      if (userMatch) {
        requireRoles(actor, 'admin');
        const targetId = Number(userMatch[1]);
        if (method === 'PUT') {
          const body = parseJsonBody(req);
          const user = await store.updateUserRole(targetId, body.role, actor);
          return res.status(200).json({ user });
        }
        if (method === 'DELETE') {
          await store.deleteUser(targetId, actor);
          return res.status(200).json({ ok: true });
        }
      }

      // Workspace snapshot
      if (method === 'GET' && rawPath === '/workspace') {
        const data = await store.getWorkspaceWithAudit();
        return res.status(200).json(data);
      }

      // Masters: Projects
      if (method === 'POST' && rawPath === '/projects') {
        requireRoles(actor, 'admin');
        const project = await store.addProject(parseJsonBody(req), actor);
        return res.status(200).json({ project });
      }

      const projMatch = /^\/projects\/(\d+)$/.exec(rawPath);
      if (projMatch) {
        requireRoles(actor, 'admin');
        const projId = Number(projMatch[1]);
        if (method === 'PUT') {
          await store.updateProject(projId, parseJsonBody(req), actor);
          return res.status(200).json({ ok: true });
        }
        if (method === 'DELETE') {
          await store.deleteProject(projId, actor);
          return res.status(200).json({ ok: true });
        }
      }

      // Masters: Subvendors
      if (method === 'POST' && rawPath === '/subvendors') {
        requireRoles(actor, 'admin');
        const body = parseJsonBody(req);
        const subVendor = await store.addSubVendor(body.name, actor);
        return res.status(200).json({ subVendor });
      }

      const svMatch = /^\/subvendors\/(\d+)$/.exec(rawPath);
      if (svMatch && method === 'DELETE') {
        requireRoles(actor, 'admin');
        await store.deleteSubVendor(Number(svMatch[1]), actor);
        return res.status(200).json({ ok: true });
      }

      // OTM - PROD
      if (method === 'POST' && rawPath === '/otm') {
        requireRoles(actor, 'admin', 'planner');
        const id = await store.addOtmItem(parseJsonBody(req), actor);
        return res.status(200).json({ id });
      }

      const otmMatch = /^\/otm\/(\d+)$/.exec(rawPath);
      if (otmMatch) {
        requireRoles(actor, 'admin', 'planner');
        const otmId = Number(otmMatch[1]);
        if (method === 'PUT') {
          await store.updateOtmItem(otmId, parseJsonBody(req), actor);
          return res.status(200).json({ ok: true });
        }
        if (method === 'DELETE') {
          await store.deleteOtmItem(otmId, actor);
          return res.status(200).json({ ok: true });
        }
      }

      // Daily Plan
      if (method === 'POST' && rawPath === '/daily-logs') {
        requireRoles(actor, 'admin', 'planner', 'supervisor');
        const id = await store.addDailyLog(parseJsonBody(req), actor);
        return res.status(200).json({ id });
      }

      const dailyMatch = /^\/daily-logs\/(\d+)$/.exec(rawPath);
      if (dailyMatch) {
        requireRoles(actor, 'admin', 'planner', 'supervisor');
        const logId = Number(dailyMatch[1]);
        if (method === 'PUT') {
          await store.updateDailyLog(logId, parseJsonBody(req), actor);
          return res.status(200).json({ ok: true });
        }
        if (method === 'DELETE') {
          await store.deleteDailyLog(logId, actor);
          return res.status(200).json({ ok: true });
        }
      }

      // MIS & Settings
      const misMatch = /^\/mis\/costs\/([^/]+)$/.exec(rawPath);
      if (misMatch && method === 'PUT') {
        requireRoles(actor, 'admin');
        await store.upsertMisCost(decodeURIComponent(misMatch[1]), parseJsonBody(req), actor);
        return res.status(200).json({ ok: true });
      }

      if (method === 'PUT' && rawPath === '/settings') {
        requireRoles(actor, 'admin', 'planner');
        await store.updateSettings(parseJsonBody(req));
        return res.status(200).json({ ok: true });
      }

      // Two-Way Excel (.xlsx) Export, Import & Seed Reset
      if (method === 'GET' && rawPath === '/excel/export') {
        const qDate = getQueryParam(req, 'asOfDate');
        const asOfDate = /^\d{4}-\d{2}-\d{2}$/.test(qDate)
          ? qDate
          : new Date().toISOString().slice(0, 10);
        const payload = await store.getWorkspacePayload();
        const buffer = buildExportWorkbook(payload, asOfDate);
        res.set(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.set(
          'Content-Disposition',
          `attachment; filename="Manufacturing_Monthly_Plan_${asOfDate}.xlsx"`
        );
        return res.status(200).send(buffer);
      }

      if (method === 'POST' && rawPath === '/excel/import') {
        requireRoles(actor, 'admin', 'planner');
        const body = parseJsonBody(req);
        if (!body.fileBase64 || typeof body.fileBase64 !== 'string') {
          fail(400, 'Please upload an Excel (.xlsx) file.');
        }
        const mode = body.mode === 'merge' ? 'merge' : 'replace';
        const fileName = String(body.fileName || 'workbook.xlsx').slice(0, 120);
        let parsed;
        try {
          const buf = Buffer.from(body.fileBase64, 'base64');
          parsed = parseManufacturingWorkbook(buf);
        } catch (err) {
          fail(400, err instanceof Error ? err.message : 'Failed to parse Excel workbook.');
        }
        if (
          parsed.projects.length === 0 &&
          parsed.otmItems.length === 0 &&
          parsed.dailyLogs.length === 0
        ) {
          fail(
            400,
            'No recognizable sheets (Masters, OTM - PROD, Daily Plan) found in uploaded workbook.'
          );
        }
        await store.applyWorkbook(
          parsed,
          mode,
          actor,
          'EXCEL_IMPORT',
          `Imported '${fileName}' (${mode}): ${parsed.projects.length} projects, ${parsed.otmItems.length} OTM items, ${parsed.dailyLogs.length} daily logs`
        );
        return res.status(200).json({
          ok: true,
          summary: {
            mode,
            projects: parsed.projects.length,
            otmItems: parsed.otmItems.length,
            dailyLogs: parsed.dailyLogs.length,
            misMonths: parsed.misCosts.length,
          },
        });
      }

      if (method === 'POST' && rawPath === '/excel/reset-seed') {
        requireRoles(actor, 'admin');
        const seedBuf = getSeedBuffer ? getSeedBuffer() : null;
        if (!seedBuf) fail(404, 'Original seed Excel file not found.');
        const parsed = parseManufacturingWorkbook(seedBuf);
        await store.applyWorkbook(
          parsed,
          'replace',
          actor,
          'RESET_TO_SEED',
          'Re-synced database from Manufacturing_Monthly_Plan_Improved.xlsx'
        );
        return res.status(200).json({
          ok: true,
          summary: {
            projects: parsed.projects.length,
            otmItems: parsed.otmItems.length,
            dailyLogs: parsed.dailyLogs.length,
          },
        });
      }

      fail(404, 'Not found.');
    } catch (error) {
      const status = error.status || 500;
      if (status === 500) {
        console.error('ForgePlan MES request failed', {
          code: error.code || 'internal',
          path: req.path || req.url,
          message: error.message,
        });
      }
      res.status(status).json({
        error:
          status === 500
            ? 'The server could not complete this request. Please try again.'
            : error.message,
      });
    }
  };
}
