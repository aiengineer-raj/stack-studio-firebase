import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret, defineString } from 'firebase-functions/params';
import { createPlanHandler } from './handler.mjs';
import { createPlanStore } from './store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, 'seed', 'Manufacturing_Monthly_Plan_Improved.xlsx');

const app = initializeApp();
const db = getFirestore(app);

// Reuses the existing Resend & OTP pepper secrets already provisioned in veplworks
const resendKey = defineSecret('WORKBOARD_RESEND_API_KEY');
const pepper = defineSecret('WORKBOARD_OTP_PEPPER');

const allowedOriginsParam = defineString('PLAN_ALLOWED_ORIGINS', {
  default:
    'https://veplworks-plan.web.app,https://veplworks-plan.firebaseapp.com,https://plan.veplworks.com',
});
const senderParam = defineString('PLAN_EMAIL_FROM', {
  default: 'VEPL Monthly Plan <login@veplworks.com>',
});

function loadSeedBuffer() {
  return fs.existsSync(SEED_PATH) ? fs.readFileSync(SEED_PATH) : null;
}

const store = createPlanStore(db, loadSeedBuffer);

const handlePlanRequest = createPlanHandler({
  db,
  store,
  getPepper: () => pepper.value(),
  getResendKey: () => resendKey.value(),
  getEmailFrom: () => senderParam.value(),
  getAllowedOrigins: () => {
    if (process.env.FUNCTIONS_EMULATOR === 'true') return new Set();
    return new Set(
      allowedOriginsParam
        .value()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  },
  getSeedBuffer: loadSeedBuffer,
});

export const planApi = onRequest(
  {
    region: 'asia-south1',
    invoker: 'public',
    secrets: [resendKey, pepper],
    timeoutSeconds: 60,
    maxInstances: 5,
    memory: '512MiB',
  },
  handlePlanRequest
);
