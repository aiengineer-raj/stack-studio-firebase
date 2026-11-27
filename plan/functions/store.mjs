import {
  DEFAULT_ROLE_MAP,
  DEFAULT_ROLE_USERS,
  VALID_ROLES,
  displayNameFromEmail,
  emailOf,
  fail,
  hasFullAccess,
} from './auth.mjs';
import { parseManufacturingWorkbook } from './excelService.mjs';

const OTM_CHUNK_SIZE = 400;
const DEFAULT_USERS_VERSION = 2;

const DEFAULT_SUBVENDORS = [
  'VEPL Fabrication',
  'Royal Engineering',
  'Chaitanya Works',
  'Balekar Heavy Rolling',
  'Apex Surface Coating',
];

const DEFAULT_DROPDOWNS = {
  material_status: ['Available', 'Partially Available', 'Not Available', 'Ordered / Awaited', 'NA'],
  fabrication_location: ['Shop', 'Subvendor'],
  drawing_status: ['Yes', 'No'],
  daily_status: ['Done', 'In Progress', 'Not Done', 'Item Completed'],
  project_status: ['Active', 'Hold', 'Closed'],
};

function monthBucketOf(isoDate) {
  const s = String(isoDate || '').trim();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : 'other';
}

function toNullableNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toZeroNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function createPlanStore(db, getSeedBuffer) {
  const root = db.collection('forgePlanMes').doc('main');
  const metaRef = root.collection('state').doc('meta');
  const usersRef = root.collection('state').doc('users');
  const auditRef = root.collection('state').doc('audit');
  const otmCol = root.collection('otmChunks');
  const dailyCol = root.collection('dailyMonths');

  async function appendAudit(actor, action, details, nextAuditId) {
    const snap = await auditRef.get();
    const entries = snap.exists ? snap.data().entries || [] : [];
    const entry = {
      id: nextAuditId,
      created_at: new Date().toISOString(),
      user_name: actor?.name || 'System',
      user_role: actor?.role || 'admin',
      action,
      details,
    };
    await auditRef.set({ entries: [entry, ...entries].slice(0, 50) });
  }

  async function readAllOtmItems() {
    const snap = await otmCol.get();
    const all = [];
    const docs = [...snap.docs].sort((a, b) => Number(a.id) - Number(b.id));
    for (const d of docs) {
      for (const item of d.data().items || []) {
        all.push(item);
      }
    }
    return all.sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
  }

  async function writeAllOtmItems(items) {
    const sorted = [...items].sort((a, b) => (a.sort_order - b.sort_order) || (a.id - b.id));
    const existingSnap = await otmCol.get();
    const chunks = [];
    for (let i = 0; i < sorted.length; i += OTM_CHUNK_SIZE) {
      chunks.push(sorted.slice(i, i + OTM_CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push([]);

    await Promise.all(
      chunks.map((chunkItems, idx) => otmCol.doc(String(idx)).set({ items: chunkItems }))
    );

    const validIds = new Set(chunks.map((_, idx) => String(idx)));
    await Promise.all(
      existingSnap.docs
        .filter((d) => !validIds.has(d.id))
        .map((d) => otmCol.doc(d.id).delete())
    );
  }

  async function readAllDailyLogs() {
    const snap = await dailyCol.get();
    const all = [];
    for (const d of snap.docs) {
      for (const log of d.data().items || []) {
        all.push(log);
      }
    }
    return all.sort((a, b) => b.log_date.localeCompare(a.log_date) || b.id - a.id);
  }

  async function writeAllDailyLogs(logs, replaceAll = false) {
    const buckets = new Map();
    for (const log of logs) {
      const key = monthBucketOf(log.log_date);
      const arr = buckets.get(key);
      if (arr) arr.push(log);
      else buckets.set(key, [log]);
    }

    if (replaceAll) {
      const existingSnap = await dailyCol.get();
      await Promise.all(
        existingSnap.docs
          .filter((d) => !buckets.has(d.id))
          .map((d) => dailyCol.doc(d.id).delete())
      );
    }

    await Promise.all(
      Array.from(buckets.entries()).map(([bucketKey, items]) =>
        dailyCol.doc(bucketKey).set({
          items: items.sort((a, b) => b.log_date.localeCompare(a.log_date) || b.id - a.id),
        })
      )
    );
  }

  function buildWorkbookState(parsed, existingState, mode, counters) {
    const projectMap = new Map();
    if (mode === 'merge') {
      for (const p of existingState.projects) {
        projectMap.set(p.project_no, { ...p });
      }
    }
    for (const p of parsed.projects) {
      const prev = projectMap.get(p.project_no);
      if (prev) {
        prev.customer_name = p.customer_name;
        prev.project_status = p.project_status;
      } else {
        counters.project += 1;
        projectMap.set(p.project_no, {
          id: counters.project,
          project_no: p.project_no,
          customer_name: p.customer_name,
          project_status: p.project_status,
        });
      }
    }
    const projects = Array.from(projectMap.values()).sort((a, b) =>
      a.project_no.localeCompare(b.project_no)
    );

    const svMap = new Map();
    if (mode === 'merge') {
      for (const sv of existingState.subVendors) {
        svMap.set(sv.name, { ...sv });
      }
    }
    for (const svName of parsed.subVendors) {
      if (!svMap.has(svName)) {
        counters.subVendor += 1;
        svMap.set(svName, { id: counters.subVendor, name: svName });
      }
    }
    if (svMap.size === 0) {
      for (const defSv of DEFAULT_SUBVENDORS) {
        counters.subVendor += 1;
        svMap.set(defSv, { id: counters.subVendor, name: defSv });
      }
    }
    const subVendors = Array.from(svMap.values()).sort((a, b) => a.name.localeCompare(b.name));

    const dropdowns = { ...DEFAULT_DROPDOWNS, ...(existingState.dropdowns || {}) };
    for (const [cat, arr] of Object.entries(parsed.dropdowns || {})) {
      if (Array.isArray(arr) && arr.length > 0 && cat in DEFAULT_DROPDOWNS) {
        dropdowns[cat] = arr;
      }
    }

    let otmItems = [];
    if (mode === 'replace') {
      otmItems = parsed.otmItems.map((item) => {
        counters.otm += 1;
        return { ...item, id: counters.otm };
      });
    } else {
      otmItems = existingState.otmItems.map((x) => ({ ...x }));
      for (const item of parsed.otmItems) {
        const matchIdx = otmItems.findIndex(
          (x) =>
            x.project_no === item.project_no && x.item_description === item.item_description
        );
        if (matchIdx >= 0) {
          otmItems[matchIdx] = {
            ...otmItems[matchIdx],
            ...item,
            id: otmItems[matchIdx].id,
            sort_order: otmItems[matchIdx].sort_order,
          };
        } else {
          counters.otm += 1;
          otmItems.push({ ...item, id: counters.otm });
        }
      }
    }

    let dailyLogs = [];
    if (mode === 'replace') {
      dailyLogs = parsed.dailyLogs.map((log) => {
        counters.daily += 1;
        return { ...log, id: counters.daily };
      });
    } else {
      dailyLogs = existingState.dailyLogs.map((x) => ({ ...x }));
      const sigSet = new Set(
        dailyLogs.map(
          (l) => `${l.log_date}||${l.project_no}||${l.item_description}||${l.work_done_today}`
        )
      );
      for (const log of parsed.dailyLogs) {
        const sig = `${log.log_date}||${log.project_no}||${log.item_description}||${log.work_done_today}`;
        if (sigSet.has(sig)) continue;
        sigSet.add(sig);
        counters.daily += 1;
        dailyLogs.push({ ...log, id: counters.daily });
      }
    }

    const misMap = new Map();
    if (mode === 'merge') {
      for (const c of existingState.misCosts) {
        misMap.set(c.month_key, { ...c });
      }
    }
    for (const c of parsed.misCosts) {
      misMap.set(c.month_key, { ...c });
    }
    const misCosts = Array.from(misMap.values()).sort((a, b) =>
      a.month_key.localeCompare(b.month_key)
    );

    const settings = {
      mis_start_month: parsed.misStartMonth || existingState.settings?.mis_start_month || '2026-07',
      default_gantt_month:
        parsed.defaultGanttMonth || existingState.settings?.default_gantt_month || '2026-10',
    };

    return { projects, subVendors, dropdowns, otmItems, dailyLogs, misCosts, settings };
  }

  let seedPromise = null;

  async function ensureSeeded() {
    if (seedPromise) return seedPromise;
    seedPromise = (async () => {
      const snap = await metaRef.get();
      if (snap.exists && snap.data()?.seeded) {
        if ((snap.data()?.defaultUsersVersion || 1) < DEFAULT_USERS_VERSION) {
          await db.runTransaction(async (tx) => {
            const [mSnap, uSnap] = await Promise.all([tx.get(metaRef), tx.get(usersRef)]);
            const meta = mSnap.data() || {};
            if ((meta.defaultUsersVersion || 1) >= DEFAULT_USERS_VERSION) return;

            const users = [...(uSnap.data()?.users || [])];
            let nextUserId = Math.max(
              meta.counters?.user || 0,
              users.reduce((mx, u) => Math.max(mx, u.id || 0), 0)
            );
            for (const preset of DEFAULT_ROLE_USERS) {
              const idx = users.findIndex((u) => u.email.toLowerCase() === preset.email);
              if (idx < 0) {
                nextUserId += 1;
                users.push({ id: nextUserId, ...preset });
              } else if (preset.email === 'ranjith.s@vedaengg.com') {
                users[idx] = {
                  ...users[idx],
                  name: users[idx].name || preset.name,
                  role: preset.role,
                  department:
                    !users[idx].department ||
                    users[idx].department === 'Shop-Floor & Engineering'
                      ? preset.department
                      : users[idx].department,
                };
              }
            }
            tx.set(usersRef, { users });
            tx.update(metaRef, {
              'counters.user': nextUserId,
              defaultUsersVersion: DEFAULT_USERS_VERSION,
            });
          });
        }
        return;
      }

      const initialUsers = DEFAULT_ROLE_USERS.map((u, idx) => ({ id: idx + 1, ...u }));
      const counters = {
        user: initialUsers.length,
        project: 0,
        subVendor: 0,
        otm: 0,
        daily: 0,
        audit: 1,
      };

      const buf = getSeedBuffer ? getSeedBuffer() : null;
      let built = {
        projects: [],
        subVendors: DEFAULT_SUBVENDORS.map((name, i) => ({ id: i + 1, name })),
        dropdowns: { ...DEFAULT_DROPDOWNS },
        otmItems: [],
        dailyLogs: [],
        misCosts: [],
        settings: { mis_start_month: '2026-07', default_gantt_month: '2026-10' },
      };
      counters.subVendor = built.subVendors.length;

      let seedDetails = 'Initialized empty ForgePlan MES workspace on Firestore';
      if (buf) {
        const parsed = parseManufacturingWorkbook(buf);
        counters.subVendor = 0;
        built = buildWorkbookState(parsed, built, 'replace', counters);
        seedDetails = `Seeded ${built.projects.length} projects, ${built.otmItems.length} OTM items, and ${built.dailyLogs.length} daily logs from Manufacturing_Monthly_Plan_Improved.xlsx`;
      }

      const usersSnap = await usersRef.get();
      if (!usersSnap.exists || !(usersSnap.data()?.users?.length > 0)) {
        await usersRef.set({ users: initialUsers });
      }

      await writeAllOtmItems(built.otmItems);
      await writeAllDailyLogs(built.dailyLogs, true);
      await auditRef.set({
        entries: [
          {
            id: 1,
            created_at: new Date().toISOString(),
            user_name: 'System',
            user_role: 'admin',
            action: 'INITIAL_SEED',
            details: seedDetails,
          },
        ],
      });
      await metaRef.set({
        seeded: true,
        defaultUsersVersion: DEFAULT_USERS_VERSION,
        counters,
        projects: built.projects,
        subVendors: built.subVendors,
        dropdowns: built.dropdowns,
        misCosts: built.misCosts,
        settings: built.settings,
      });
    })().finally(() => {
      seedPromise = null;
    });
    return seedPromise;
  }

  async function getOrRegisterOtpUser(rawEmail) {
    await ensureSeeded();
    const email = emailOf(rawEmail);
    return db.runTransaction(async (tx) => {
      const [metaSnap, usersSnap] = await Promise.all([tx.get(metaRef), tx.get(usersRef)]);
      const meta = metaSnap.data();
      const users = [...(usersSnap.data()?.users || [])];
      const existing = users.find((u) => u.email.toLowerCase() === email);
      if (existing) return existing;

      const preset = DEFAULT_ROLE_MAP.get(email);
      const hasAnyFullAccess = users.some((u) => hasFullAccess(u.role));
      const role = preset ? preset.role : !hasAnyFullAccess ? 'admin' : 'supervisor';
      const nextId = (meta.counters?.user || users.length) + 1;
      const newUser = {
        id: nextId,
        email,
        name: preset?.name || displayNameFromEmail(email),
        role,
        department:
          preset?.department ||
          (hasFullAccess(role) ? 'Management & MIS' : 'Shop-Floor & Engineering'),
      };
      users.push(newUser);
      tx.set(usersRef, { users });
      tx.update(metaRef, { 'counters.user': nextId });
      return newUser;
    });
  }

  async function getUserByEmail(rawEmail) {
    await ensureSeeded();
    const email = String(rawEmail || '').trim().toLowerCase();
    const snap = await usersRef.get();
    const users = snap.data()?.users || [];
    return users.find((u) => u.email.toLowerCase() === email) || null;
  }

  async function listUsers() {
    await ensureSeeded();
    const snap = await usersRef.get();
    const users = snap.data()?.users || [];
    return [...users].sort((a, b) => a.id - b.id);
  }

  async function upsertUser({ name, email: rawEmail, role, department }, actor) {
    await ensureSeeded();
    const email = emailOf(rawEmail);
    const cleanName = String(name || '').trim();
    if (!cleanName) fail(400, 'Full name is required.');
    if (!VALID_ROLES.includes(role)) fail(400, 'Invalid role.');
    const cleanDept = String(department || '').trim();

    let savedUser = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const [metaSnap, usersSnap] = await Promise.all([tx.get(metaRef), tx.get(usersRef)]);
      const meta = metaSnap.data();
      const users = [...(usersSnap.data()?.users || [])];
      const idx = users.findIndex((u) => u.email.toLowerCase() === email);
      auditId = (meta.counters?.audit || 0) + 1;

      if (idx >= 0) {
        if (users[idx].id === actor?.id && !hasFullAccess(role)) {
          fail(400, 'You cannot remove your own full-access role.');
        }
        savedUser = {
          ...users[idx],
          name: cleanName,
          role,
          department: cleanDept || users[idx].department || '',
        };
        users[idx] = savedUser;
        tx.set(usersRef, { users });
        tx.update(metaRef, { 'counters.audit': auditId });
      } else {
        const nextId = (meta.counters?.user || users.length) + 1;
        savedUser = {
          id: nextId,
          email,
          name: cleanName,
          role,
          department: cleanDept,
        };
        users.push(savedUser);
        tx.set(usersRef, { users });
        tx.update(metaRef, {
          'counters.user': nextId,
          'counters.audit': auditId,
        });
      }
    });

    await appendAudit(actor, 'UPSERT_USER', `Saved user ${savedUser.name} (${savedUser.email}) as ${savedUser.role}`, auditId);
    return savedUser;
  }

  async function updateUserRole(targetId, role, actor) {
    await ensureSeeded();
    if (!VALID_ROLES.includes(role)) fail(400, 'Invalid role.');
    if (actor?.id === targetId && !hasFullAccess(role)) {
      fail(400, 'You cannot remove your own full-access role.');
    }

    let updated = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const [metaSnap, usersSnap] = await Promise.all([tx.get(metaRef), tx.get(usersRef)]);
      const meta = metaSnap.data();
      const users = [...(usersSnap.data()?.users || [])];
      const idx = users.findIndex((u) => u.id === targetId);
      if (idx < 0) fail(404, 'User not found.');
      updated = { ...users[idx], role };
      users[idx] = updated;
      auditId = (meta.counters?.audit || 0) + 1;
      tx.set(usersRef, { users });
      tx.update(metaRef, { 'counters.audit': auditId });
    });

    await appendAudit(actor, 'UPDATE_USER_ROLE', `Updated ${updated.name} (${updated.email}) role to ${role}`, auditId);
    return updated;
  }

  async function deleteUser(targetId, actor) {
    await ensureSeeded();
    if (actor?.id === targetId) {
      fail(400, 'You cannot delete your own active account.');
    }

    let removed = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const [metaSnap, usersSnap] = await Promise.all([tx.get(metaRef), tx.get(usersRef)]);
      const meta = metaSnap.data();
      const users = [...(usersSnap.data()?.users || [])];
      const idx = users.findIndex((u) => u.id === targetId);
      if (idx < 0) return;
      removed = users[idx];
      users.splice(idx, 1);
      auditId = (meta.counters?.audit || 0) + 1;
      tx.set(usersRef, { users });
      tx.update(metaRef, { 'counters.audit': auditId });
    });

    if (removed) {
      await appendAudit(actor, 'DELETE_USER', `Removed user ${removed.name} (${removed.email})`, auditId);
    }
  }

  async function getWorkspacePayload() {
    await ensureSeeded();
    const [metaSnap, otmItems, dailyLogs] = await Promise.all([
      metaRef.get(),
      readAllOtmItems(),
      readAllDailyLogs(),
    ]);
    const meta = metaSnap.data();
    return {
      projects: [...(meta.projects || [])].sort((a, b) => a.project_no.localeCompare(b.project_no)),
      subVendors: [...(meta.subVendors || [])].sort((a, b) => a.name.localeCompare(b.name)),
      dropdowns: { ...DEFAULT_DROPDOWNS, ...(meta.dropdowns || {}) },
      otmItems,
      dailyLogs,
      misCosts: [...(meta.misCosts || [])].sort((a, b) => a.month_key.localeCompare(b.month_key)),
      settings: {
        mis_start_month: meta.settings?.mis_start_month || '2026-07',
        default_gantt_month: meta.settings?.default_gantt_month || '2026-10',
      },
    };
  }

  async function getWorkspaceWithAudit() {
    const [payload, auditSnap] = await Promise.all([getWorkspacePayload(), auditRef.get()]);
    const auditLogs = auditSnap.exists ? auditSnap.data()?.entries || [] : [];
    return { ...payload, auditLogs: auditLogs.slice(0, 40) };
  }

  async function addProject({ project_no, customer_name, project_status }, actor) {
    await ensureSeeded();
    const pNo = String(project_no || '').trim();
    if (!pNo) fail(400, 'Project No is required.');
    const cust = String(customer_name || '').trim();
    const st = project_status === 'Hold' || project_status === 'Closed' ? project_status : 'Active';

    let created = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const projects = [...(meta.projects || [])];
      if (projects.some((p) => p.project_no.toLowerCase() === pNo.toLowerCase())) {
        fail(400, `Project '${pNo}' already exists in Masters.`);
      }
      const nextId = (meta.counters?.project || projects.length) + 1;
      auditId = (meta.counters?.audit || 0) + 1;
      created = { id: nextId, project_no: pNo, customer_name: cust, project_status: st };
      projects.push(created);
      tx.update(metaRef, {
        projects,
        'counters.project': nextId,
        'counters.audit': auditId,
      });
    });

    await appendAudit(actor, 'ADD_PROJECT', `Created project ${pNo} (${cust})`, auditId);
    return created;
  }

  async function updateProject(id, { project_no, customer_name, project_status }, actor) {
    await ensureSeeded();
    let oldProjNo = '';
    let newProjNo = '';
    let st = 'Active';
    let auditId = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const projects = [...(meta.projects || [])];
      const idx = projects.findIndex((p) => p.id === id);
      if (idx < 0) fail(404, 'Project not found.');
      oldProjNo = projects[idx].project_no;
      newProjNo = String(project_no || oldProjNo).trim();
      st = project_status === 'Hold' || project_status === 'Closed' ? project_status : 'Active';
      if (
        newProjNo.toLowerCase() !== oldProjNo.toLowerCase() &&
        projects.some((p, i) => i !== idx && p.project_no.toLowerCase() === newProjNo.toLowerCase())
      ) {
        fail(400, `Project '${newProjNo}' already exists.`);
      }
      projects[idx] = {
        ...projects[idx],
        project_no: newProjNo,
        customer_name: String(customer_name ?? projects[idx].customer_name).trim(),
        project_status: st,
      };
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { projects, 'counters.audit': auditId });
    });

    if (newProjNo !== oldProjNo) {
      const [otmItems, dailyLogs] = await Promise.all([readAllOtmItems(), readAllDailyLogs()]);
      let otmChanged = false;
      for (const item of otmItems) {
        if (item.project_no === oldProjNo) {
          item.project_no = newProjNo;
          otmChanged = true;
        }
      }
      let dailyChanged = false;
      for (const log of dailyLogs) {
        if (log.project_no === oldProjNo) {
          log.project_no = newProjNo;
          dailyChanged = true;
        }
      }
      await Promise.all([
        otmChanged ? writeAllOtmItems(otmItems) : Promise.resolve(),
        dailyChanged ? writeAllDailyLogs(dailyLogs, false) : Promise.resolve(),
      ]);
    }

    await appendAudit(actor, 'UPDATE_PROJECT', `Updated project ${newProjNo} (${st})`, auditId);
  }

  async function deleteProject(id, actor) {
    await ensureSeeded();
    let deletedNo = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const projects = [...(meta.projects || [])];
      const idx = projects.findIndex((p) => p.id === id);
      if (idx < 0) return;
      deletedNo = projects[idx].project_no;
      projects.splice(idx, 1);
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { projects, 'counters.audit': auditId });
    });
    if (deletedNo) {
      await appendAudit(actor, 'DELETE_PROJECT', `Deleted project ${deletedNo} from Masters`, auditId);
    }
  }

  async function addSubVendor(name, actor) {
    await ensureSeeded();
    const clean = String(name || '').trim();
    if (!clean) fail(400, 'Sub-vendor name is required.');

    let created = null;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const subVendors = [...(meta.subVendors || [])];
      if (subVendors.some((s) => s.name.toLowerCase() === clean.toLowerCase())) {
        fail(400, 'Sub-vendor already exists.');
      }
      const nextId = (meta.counters?.subVendor || subVendors.length) + 1;
      auditId = (meta.counters?.audit || 0) + 1;
      created = { id: nextId, name: clean };
      subVendors.push(created);
      tx.update(metaRef, {
        subVendors,
        'counters.subVendor': nextId,
        'counters.audit': auditId,
      });
    });

    await appendAudit(actor, 'ADD_SUBVENDOR', `Added sub-vendor ${clean}`, auditId);
    return created;
  }

  async function deleteSubVendor(id, actor) {
    await ensureSeeded();
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const subVendors = (meta.subVendors || []).filter((s) => s.id !== id);
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { subVendors, 'counters.audit': auditId });
    });
    await appendAudit(actor, 'DELETE_SUBVENDOR', `Removed sub-vendor #${id}`, auditId);
  }

  async function addOtmItem(b, actor) {
    await ensureSeeded();
    const pNo = String(b?.project_no || '').trim();
    const iDesc = String(b?.item_description || '').trim();
    if (!pNo || !iDesc) fail(400, 'Project No and Item Description are required.');

    let nextId = 0;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      nextId = (meta.counters?.otm || 0) + 1;
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.otm': nextId, 'counters.audit': auditId });
    });

    const items = await readAllOtmItems();
    const maxSort = items.reduce((mx, x) => Math.max(mx, x.sort_order || 0), 0);
    items.push({
      id: nextId,
      sort_order: maxSort + 1,
      project_no: pNo,
      item_description: iDesc,
      wt_cost_sheet_kg: toNullableNum(b.wt_cost_sheet_kg),
      wt_drawing_kg: toNullableNum(b.wt_drawing_kg),
      drawing_released: String(b.drawing_released || ''),
      material_status: String(b.material_status || ''),
      material_req_at_shop: String(b.material_req_at_shop || ''),
      fabrication_location: String(b.fabrication_location || ''),
      sub_vendor: String(b.sub_vendor || ''),
      po_no: String(b.po_no || ''),
      po_date: String(b.po_date || ''),
      po_value_rs: toNullableNum(b.po_value_rs),
      subvendor_delivery_date: String(b.subvendor_delivery_date || ''),
      advance_amount_rs: toNullableNum(b.advance_amount_rs),
      advance_date: String(b.advance_date || ''),
      customer_delivery_date: String(b.customer_delivery_date || ''),
      revised_agreed_date: String(b.revised_agreed_date || ''),
      plan_start: String(b.plan_start || ''),
      plan_end: String(b.plan_end || ''),
      actual_dispatch_date: String(b.actual_dispatch_date || ''),
      remarks: String(b.remarks || ''),
    });
    await writeAllOtmItems(items);
    await appendAudit(actor, 'ADD_OTM_ITEM', `Added OTM item '${iDesc}' under ${pNo}`, auditId);
    return nextId;
  }

  async function updateOtmItem(id, patch, actor) {
    await ensureSeeded();
    const items = await readAllOtmItems();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) fail(404, 'OTM item not found.');
    const b = { ...items[idx], ...patch };
    items[idx] = {
      id,
      sort_order: items[idx].sort_order,
      project_no: String(b.project_no || '').trim(),
      item_description: String(b.item_description || '').trim(),
      wt_cost_sheet_kg: toNullableNum(b.wt_cost_sheet_kg),
      wt_drawing_kg: toNullableNum(b.wt_drawing_kg),
      drawing_released: String(b.drawing_released || ''),
      material_status: String(b.material_status || ''),
      material_req_at_shop: String(b.material_req_at_shop || ''),
      fabrication_location: String(b.fabrication_location || ''),
      sub_vendor: String(b.sub_vendor || ''),
      po_no: String(b.po_no || ''),
      po_date: String(b.po_date || ''),
      po_value_rs: toNullableNum(b.po_value_rs),
      subvendor_delivery_date: String(b.subvendor_delivery_date || ''),
      advance_amount_rs: toNullableNum(b.advance_amount_rs),
      advance_date: String(b.advance_date || ''),
      customer_delivery_date: String(b.customer_delivery_date || ''),
      revised_agreed_date: String(b.revised_agreed_date || ''),
      plan_start: String(b.plan_start || ''),
      plan_end: String(b.plan_end || ''),
      actual_dispatch_date: String(b.actual_dispatch_date || ''),
      remarks: String(b.remarks || ''),
    };
    await writeAllOtmItems(items);

    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      auditId = (snap.data()?.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.audit': auditId });
    });
    await appendAudit(
      actor,
      'UPDATE_OTM_ITEM',
      `Updated OTM item '${items[idx].item_description}' (${items[idx].project_no})`,
      auditId
    );
  }

  async function deleteOtmItem(id, actor) {
    await ensureSeeded();
    const items = await readAllOtmItems();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return;
    const removed = items[idx];
    items.splice(idx, 1);
    await writeAllOtmItems(items);

    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      auditId = (snap.data()?.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.audit': auditId });
    });
    await appendAudit(
      actor,
      'DELETE_OTM_ITEM',
      `Deleted OTM item '${removed.item_description}' (${removed.project_no})`,
      auditId
    );
  }

  async function addDailyLog(b, actor) {
    await ensureSeeded();
    const logDate = String(b?.log_date || '').trim();
    const pNo = String(b?.project_no || '').trim();
    const iDesc = String(b?.item_description || '').trim();
    if (!logDate || !pNo || !iDesc) fail(400, 'Date, Project No, and Item are required.');

    let nextId = 0;
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      nextId = (meta.counters?.daily || 0) + 1;
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.daily': nextId, 'counters.audit': auditId });
    });

    const newLog = {
      id: nextId,
      log_date: logDate,
      project_no: pNo,
      item_description: iDesc,
      work_done_today: String(b?.work_done_today || '').trim(),
      status: String(b?.status || 'Done').trim(),
      actual_completion_date: String(b?.actual_completion_date || '').trim(),
      remarks: String(b?.remarks || '').trim(),
    };

    const bucketRef = dailyCol.doc(monthBucketOf(logDate));
    await db.runTransaction(async (tx) => {
      const bSnap = await tx.get(bucketRef);
      const items = bSnap.exists ? [...(bSnap.data()?.items || [])] : [];
      items.push(newLog);
      items.sort((a, c) => c.log_date.localeCompare(a.log_date) || c.id - a.id);
      tx.set(bucketRef, { items });
    });

    await appendAudit(
      actor,
      'LOG_DAILY_WORK',
      `${logDate}: ${pNo} - ${iDesc} (${newLog.status})`,
      auditId
    );
    return nextId;
  }

  async function updateDailyLog(id, patch, actor) {
    await ensureSeeded();
    const snap = await dailyCol.get();
    let oldDocId = null;
    let existing = null;
    for (const d of snap.docs) {
      const hit = (d.data()?.items || []).find((x) => x.id === id);
      if (hit) {
        oldDocId = d.id;
        existing = hit;
        break;
      }
    }
    if (!existing) fail(404, 'Daily log entry not found.');

    const b = { ...existing, ...patch };
    const updated = {
      id,
      log_date: String(b.log_date || '').trim(),
      project_no: String(b.project_no || '').trim(),
      item_description: String(b.item_description || '').trim(),
      work_done_today: String(b.work_done_today || '').trim(),
      status: String(b.status || '').trim(),
      actual_completion_date: String(b.actual_completion_date || '').trim(),
      remarks: String(b.remarks || '').trim(),
    };
    const newDocId = monthBucketOf(updated.log_date);

    if (oldDocId === newDocId) {
      const ref = dailyCol.doc(newDocId);
      await db.runTransaction(async (tx) => {
        const dSnap = await tx.get(ref);
        const items = (dSnap.data()?.items || []).map((x) => (x.id === id ? updated : x));
        items.sort((a, c) => c.log_date.localeCompare(a.log_date) || c.id - a.id);
        tx.set(ref, { items });
      });
    } else {
      const oldRef = dailyCol.doc(oldDocId);
      const newRef = dailyCol.doc(newDocId);
      await db.runTransaction(async (tx) => {
        const [oldSnap, newSnap] = await Promise.all([tx.get(oldRef), tx.get(newRef)]);
        const oldItems = (oldSnap.data()?.items || []).filter((x) => x.id !== id);
        const newItems = [...(newSnap.exists ? newSnap.data()?.items || [] : []), updated].sort(
          (a, c) => c.log_date.localeCompare(a.log_date) || c.id - a.id
        );
        tx.set(oldRef, { items: oldItems });
        tx.set(newRef, { items: newItems });
      });
    }

    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(metaRef);
      auditId = (mSnap.data()?.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.audit': auditId });
    });
    await appendAudit(
      actor,
      'UPDATE_DAILY_WORK',
      `Updated daily log #${id} (${updated.project_no} - ${updated.item_description})`,
      auditId
    );
  }

  async function deleteDailyLog(id, actor) {
    await ensureSeeded();
    const snap = await dailyCol.get();
    for (const d of snap.docs) {
      const items = d.data()?.items || [];
      if (items.some((x) => x.id === id)) {
        await dailyCol.doc(d.id).set({ items: items.filter((x) => x.id !== id) });
        break;
      }
    }
    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const mSnap = await tx.get(metaRef);
      auditId = (mSnap.data()?.counters?.audit || 0) + 1;
      tx.update(metaRef, { 'counters.audit': auditId });
    });
    await appendAudit(actor, 'DELETE_DAILY_WORK', `Deleted daily log #${id}`, auditId);
  }

  async function upsertMisCost(monthKey, b, actor) {
    await ensureSeeded();
    const mk = String(monthKey || '').trim();
    if (!/^\d{4}-\d{2}$/.test(mk)) fail(400, 'Invalid month format (expected YYYY-MM).');

    const record = {
      month_key: mk,
      rent: toZeroNum(b?.rent),
      electricity: toZeroNum(b?.electricity),
      water_bill: toZeroNum(b?.water_bill),
      tea_snacks: toZeroNum(b?.tea_snacks),
      security: toZeroNum(b?.security),
      rolling_cost: toZeroNum(b?.rolling_cost),
      balekar_crane: toZeroNum(b?.balekar_crane),
      local_transport: toZeroNum(b?.local_transport),
      painting: toZeroNum(b?.painting),
      vepl: toZeroNum(b?.vepl),
      royal: toZeroNum(b?.royal),
      chaitanya: toZeroNum(b?.chaitanya),
      paint: toZeroNum(b?.paint),
      industrial_gas: toZeroNum(b?.industrial_gas),
      consumables: toZeroNum(b?.consumables),
      food_local_purchase: toZeroNum(b?.food_local_purchase),
      repair_maintenance: toZeroNum(b?.repair_maintenance),
      wip_tons: toZeroNum(b?.wip_tons),
      remark: String(b?.remark || ''),
    };

    let auditId = 0;
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const meta = snap.data();
      const misCosts = [...(meta.misCosts || [])];
      const idx = misCosts.findIndex((c) => c.month_key === mk);
      if (idx >= 0) misCosts[idx] = record;
      else misCosts.push(record);
      auditId = (meta.counters?.audit || 0) + 1;
      tx.update(metaRef, { misCosts, 'counters.audit': auditId });
    });

    await appendAudit(actor, 'UPDATE_MIS_COSTS', `Updated MIS monthly costs for ${mk}`, auditId);
  }

  async function updateSettings({ mis_start_month, default_gantt_month }) {
    await ensureSeeded();
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(metaRef);
      const settings = { ...(snap.data()?.settings || {}) };
      if (mis_start_month && /^\d{4}-\d{2}$/.test(mis_start_month)) {
        settings.mis_start_month = mis_start_month;
      }
      if (default_gantt_month && /^\d{4}-\d{2}$/.test(default_gantt_month)) {
        settings.default_gantt_month = default_gantt_month;
      }
      tx.update(metaRef, { settings });
    });
  }

  async function applyWorkbook(parsed, mode, actor, auditAction, auditDetails) {
    await ensureSeeded();
    const current = await getWorkspacePayload();
    const metaSnap = await metaRef.get();
    const counters = { ...(metaSnap.data()?.counters || {}) };
    if (mode === 'replace') {
      counters.project = 0;
      counters.subVendor = 0;
      counters.otm = 0;
      counters.daily = 0;
    }

    const built = buildWorkbookState(parsed, current, mode, counters);
    counters.audit = (counters.audit || 0) + 1;

    await writeAllOtmItems(built.otmItems);
    await writeAllDailyLogs(built.dailyLogs, mode === 'replace');
    await metaRef.update({
      counters,
      projects: built.projects,
      subVendors: built.subVendors,
      dropdowns: built.dropdowns,
      misCosts: built.misCosts,
      settings: built.settings,
    });
    await appendAudit(actor, auditAction, auditDetails, counters.audit);
  }

  return {
    root,
    ensureSeeded,
    getOrRegisterOtpUser,
    getUserByEmail,
    listUsers,
    upsertUser,
    updateUserRole,
    deleteUser,
    getWorkspacePayload,
    getWorkspaceWithAudit,
    addProject,
    updateProject,
    deleteProject,
    addSubVendor,
    deleteSubVendor,
    addOtmItem,
    updateOtmItem,
    deleteOtmItem,
    addDailyLog,
    updateDailyLog,
    deleteDailyLog,
    upsertMisCost,
    updateSettings,
    applyWorkbook,
  };
}
