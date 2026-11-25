import { mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import * as baileys from '@whiskeysockets/baileys';
import pino from 'pino';
import { bindCommands } from './commands.mjs';

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;
const logger = pino({ level: 'silent' });
const BOT_ID = 'venom';
const POLL_MS = 5000;
const FAILURE_GRACE_MS = 25000;
const MAX_SESSIONS = 16;
const sessionRoot = fileURLToPath(new URL('./site-sessions/', import.meta.url));
const validPhone = /^[1-9]\d{6,14}$/;
const validUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalReasons = new Set([
  DisconnectReason.loggedOut,
  DisconnectReason.badSession,
  DisconnectReason.connectionReplaced,
  DisconnectReason.multideviceMismatch,
  DisconnectReason.forbidden,
]);

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const workerKey = process.env.VENOM_WORKER_KEY || '';
const workerId = process.env.VENOM_WORKER_ID || randomUUID();

// Le backend exige p_bot, p_key, p_worker, p_ids.
async function rpc(functionName, params) {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    let errorCode = '';
    try {
      const payload = await response.json();
      errorCode = String(payload?.code || '').slice(0, 40);
    } catch {}
    throw new Error(`${functionName} HTTP ${response.status}${errorCode ? ` (${errorCode})` : ''}`);
  }
  return response.json();
}

const shared = () => ({ p_bot: BOT_ID, p_key: workerKey, p_worker: workerId });
const poll = ids => rpc('bot_connect_worker_poll', { ...shared(), p_ids: ids });
const update = (id, status, code = null) =>
  rpc('bot_connect_worker_update', {
    ...shared(), p_id: id, p_status: status, p_code: code,
  });

function createSession(job, globalSignal, onExited) {
  const id = job.id;
  const phone = job.phone;
  const stopController = new AbortController();
  let socket = null;
  let authorized = true;
  let active = false;
  let reconnectDelay = 1000;

  const permitted = () => authorized && !stopController.signal.aborted && !globalSignal.aborted;
  const stop = () => {
    authorized = false;
    stopController.abort();
    active = false;
    try { socket?.end(undefined); } catch {}
  };

  async function run() {
    const generation = createHash('sha256').update(job.requestedAt).digest('hex');
    const location = join(sessionRoot, id, generation);
    await mkdir(location, { recursive: true, mode: 0o700 });

    while (permitted()) {
      const { state, saveCreds } = await useMultiFileAuthState(location);
      if (!permitted()) return;
      let saving = Promise.resolve();
      let requested = false;
      let finished = false;
      let resolveClose;
      const closed = new Promise(resolve => { resolveClose = resolve; });
      const current = makeWASocket({
        auth: state, logger, connectTimeoutMs: 15000,
        printQRInTerminal: false, markOnlineOnConnect: false,
        shouldSyncHistoryMessage: () => false,
      });
      socket = current;

      // Le menu et l’exécution utilisent le même registre de commandes autorisées.
      const onMessages = bindCommands(current, baileys,
        () => active && permitted() && socket === current);
      const onCreds = () => {
        saving = saving.then(saveCreds).catch(error =>
          console.error(`[VENOM V4] ${id}: sauvegarde de session impossible :`, error.message));
      };
      const onUpsert = event => {
        if (!permitted() || !active || socket !== current) return;
        Promise.resolve().then(() => onMessages(event)).catch(error =>
          console.warn(`[VENOM V4] ${id}: erreur commande :`, error.message));
      };
      async function sendPairCode() {
        if (!permitted() || requested || state.creds.registered || socket !== current) return;
        requested = true;
        try {
          // Le QR est interne à Baileys. Aucun QR n'est affiché à l'utilisateur.
          await sleep(1500, undefined, { signal: stopController.signal });
          if (!permitted() || socket !== current) return;
          const rawCode = await current.requestPairingCode(phone);
          const code = String(rawCode).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
          if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('Format PAIR invalide');
          if (!permitted() || socket !== current) return;
          const accepted = await update(id, 'pairing', code);
          if (!accepted) { stop(); return; }
          console.log(`[VENOM V4] ${id}: code PAIR transmis à Bot Connect.`);
        } catch (error) {
          requested = false;
          if (permitted()) console.warn(`[VENOM V4] ${id}: PAIR non disponible :`, error.message);
        }
      }
      const onUpdate = event => {
        if (!permitted() || socket !== current) return;
        if ((event.qr || event.connection === 'connecting') && !state.creds.registered) void sendPairCode();
        if (event.connection === 'open') {
          void (async () => {
            if (!permitted() || socket !== current) return;
            try {
              const accepted = await update(id, 'connected');
              if (!accepted || !permitted() || finished || socket !== current) { stop(); return; }
              active = true;
              reconnectDelay = 1000;
              console.log(`[VENOM V4] ${id}: WhatsApp connecté, accès autorisé.`);
            } catch (error) {
              console.error(`[VENOM V4] ${id}: validation backend échouée :`, error.message);
              // Fail closed ; le site ne peut pas autoriser cette connexion.
              stop();
            }
          })();
        } else if (event.connection === 'close' && !finished) {
          finished = true;
          active = false;
          resolveClose(event.lastDisconnect?.error?.output?.statusCode);
        }
      };
      current.ev.on('creds.update', onCreds);
      current.ev.on('messages.upsert', onUpsert);
      current.ev.on('connection.update', onUpdate);
      const aborted = () => { if (!finished) { finished = true; resolveClose(undefined); } };
      stopController.signal.addEventListener('abort', aborted, { once: true });
      globalSignal.addEventListener('abort', aborted, { once: true });
      const reason = await closed;
      stopController.signal.removeEventListener('abort', aborted);
      globalSignal.removeEventListener('abort', aborted);
      current.ev.off('creds.update', onCreds);
      current.ev.off('messages.upsert', onUpsert);
      current.ev.off('connection.update', onUpdate);
      if (socket === current) socket = null;
      try { current.end(undefined); } catch {}
      await saving;
      if (!permitted()) return;
      if (terminalReasons.has(reason)) {
        console.warn(`[VENOM V4] ${id}: session WhatsApp refusée (${reason}).`);
        try { await update(id, 'disconnected'); } catch {}
        return;
      }
      const wait = reason === DisconnectReason.restartRequired ? 0 : reconnectDelay;
      await sleep(wait, undefined, { signal: stopController.signal }).catch(() => {});
      reconnectDelay = Math.min(reconnectDelay * 2, 15000);
    }
  }

  const task = run().catch(error => {
    console.error(`[VENOM V4] ${id}: erreur :`, error.message);
    try { socket?.end(undefined); } catch {}
  }).finally(() => {
    onExited(id);
  });
  return { id, requestedAt: job.requestedAt, stop, task };
}

let workerStarted = false;

async function start() {
  if (workerStarted) {
    console.warn('[VENOM V4] Le worker Bot Connect tourne deja dans ce processus.');
    return;
  }
  workerStarted = true;
  if (!supabaseUrl.startsWith('https://') || !supabaseKey || !workerKey) {
    workerStarted = false;
    throw new Error('Configure SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (ou SUPABASE_ANON_KEY) et VENOM_WORKER_KEY.');
  }
  if (!validUuid.test(workerId)) {
    workerStarted = false;
    throw new Error('VENOM_WORKER_ID doit être un UUID valide.');
  }
  await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const activeSessions = new Map();
  const halt = () => controller.abort();
  process.once('SIGINT', halt);
  process.once('SIGTERM', halt);
  let lastSuccessAt = 0;
  let authorizationTimer;
  const suspend = () => {
    for (const session of activeSessions.values()) session.stop();
  };
  console.log('[VENOM V4] Démarrage du worker Bot Connect (sessions clients séparées).');

  try {
    while (!controller.signal.aborted) {
      try {
        const jobs = await poll([...activeSessions.keys()]);
        if (!Array.isArray(jobs)) throw new Error('Réponse RPC invalide');
        if (jobs.length > MAX_SESSIONS) throw new Error('Trop de sessions retournées');
        const authorized = new Map();
        for (const job of jobs) {
          if (validUuid.test(job?.id) && validPhone.test(job?.phone) &&
              typeof job.requestedAt === 'string' && Number.isFinite(Date.parse(job.requestedAt)) &&
              ['pending', 'pairing', 'connected'].includes(job?.status)) {
            authorized.set(job.id, job);
          }
        }
        if (!lastSuccessAt) console.log('[VENOM V4] Bot Connect : synchronisation réussie.');
        lastSuccessAt = Date.now();
        clearTimeout(authorizationTimer);
        authorizationTimer = setTimeout(suspend, FAILURE_GRACE_MS);
        // Une absence dans le snapshot signifie révocation : fermer immédiatement.
        for (const [id, session] of activeSessions) {
          if (authorized.get(id)?.requestedAt !== session.requestedAt) {
            session.stop();
            activeSessions.delete(id);
            await session.task;
            console.log(`[VENOM V4] ${id}: session révoquée par Bot Connect.`);
          }
        }
        for (const [id, job] of authorized) {
          if (activeSessions.has(id)) continue;
          const session = createSession(job, controller.signal, exitedId => {
            if (activeSessions.get(exitedId) === session) activeSessions.delete(exitedId);
          });
          activeSessions.set(id, session);
        }
      } catch (error) {
        console.warn('[VENOM V4] Synchronisation impossible :', error.message);
        if (!lastSuccessAt || Date.now() - lastSuccessAt > FAILURE_GRACE_MS) {
          suspend();
          await Promise.allSettled([...activeSessions.values()].map(session => session.task));
          console.warn('[VENOM V4] Sessions suspendues : autorisation backend indisponible.');
        }
      }
      await sleep(POLL_MS, undefined, { signal: controller.signal }).catch(() => {});
    }
  } finally {
    clearTimeout(authorizationTimer);
    for (const session of activeSessions.values()) session.stop();
    await Promise.allSettled([...activeSessions.values()].map(session => session.task));
    process.off('SIGINT', halt);
    process.off('SIGTERM', halt);
    workerStarted = false;
  }
}

await start();
