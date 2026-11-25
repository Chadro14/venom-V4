import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCommands } from './commands.mjs';

const self = '243123456789@s.whatsapp.net';
const normalize = jid => jid.replace(/:\d+@/, '@');

function message(text, key = {}) {
  return {
    key: { fromMe: true, remoteJid: self, ...key },
    message: { conversation: text },
  };
}

test('menu et alias autorisés, commande inconnue ignorée', async () => {
  const replies = [];
  const socket = {
    user: { id: '243123456789:2@s.whatsapp.net' },
    sendMessage: async (_, reply) => replies.push(reply.text),
  };
  const dispatch = bindCommands(socket, { jidNormalizedUser: normalize }, () => true);
  await dispatch({ type: 'notify', messages: [
    message('.menu'), message('.ping'), message('.help'), message('.unknown'), message('.ping extra'),
  ] });
  assert.equal(replies.length, 3);
  assert.match(replies[0], /^\*VENOM V4 · Bot Connect\*/);
  assert.deepEqual(replies[0].split('\n').slice(1).map(line => line.split(' ')[0]), ['.menu', '.ping', '.aide']);
  assert.equal(replies[1], 'Pong · Venom V4');
  assert.match(replies[2], /bot-connect\.ink-drop\.app/);
});

test('seuls les nouveaux messages du client dans son propre chat sont traités', async () => {
  let authorized = true;
  let sends = 0;
  const socket = { user: { id: self }, sendMessage: async () => { sends++; } };
  const dispatch = bindCommands(socket, { jidNormalizedUser: normalize }, () => authorized);
  await dispatch({ type: 'append', messages: [message('.ping')] });
  await dispatch({ type: 'notify', messages: [
    message('.ping', { fromMe: false }),
    message('.ping', { remoteJid: '123@g.us' }),
    message('.ping', { remoteJid: '456@s.whatsapp.net' }),
  ] });
  authorized = false;
  await dispatch({ type: 'notify', messages: [message('.ping')] });
  assert.equal(sends, 0);
});
