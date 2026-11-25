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
    sendMessage: async (_, reply) => replies.push(reply.text ?? reply.caption),
  };
  const dispatch = bindCommands(socket, { jidNormalizedUser: normalize }, () => true);
  await dispatch({ type: 'notify', messages: [
    message('.menu'), message('.ping'), message('.help'), message('.unknown'),
    message('.runtime'), message('.dice'), message('.readmore début | suite'),
    message('.aide'), message('.spam'), message('.crash'),
  ] });
  assert.equal(replies.length, 6);
  assert.match(replies[0], /VENOM V4[\s\S]*\.stickermenu/);
  assert.equal(replies[1], '🏓 Pong · Venom V4');
  assert.equal(replies[2], replies[0]);
  assert.match(replies[3], /en ligne depuis/);
  assert.match(replies[4], /[⚀-⚅]/u);
  assert.match(replies[5], /^début\u200e+suite$/u);
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

test('les sous-menus présentent des commandes exécutables', async () => {
  const replies = [];
  const socket = { user: { id: self }, sendMessage: async (_, reply) => replies.push(reply.text ?? reply.caption) };
  const dispatch = bindCommands(socket, { jidNormalizedUser: normalize }, () => true);
  const send = (text, key) => dispatch({ type: 'notify', messages: [message(text, key)] });
  await send('.menu');
  const menus = [...replies.at(-1).matchAll(/│ \.(\w+menu)\b/g)].map(match => match[1]);
  assert.equal(menus.length, 10);
  for (const menu of menus) {
    await send('.' + menu);
    assert.match(replies.at(-1), /│ \./);
  }
  await send('.allmenu');
  const list = [...replies.at(-1).matchAll(/│ \.(\w+)\b/g)].map(match => match[1]);
  assert.equal(new Set(list).size, 28);
  await send('.fliptext Venom');
  assert.equal(replies.at(-1), 'moneV');
  await send('.dbinary 01000001');
  assert.equal(replies.at(-1), 'A');
  const group = '123@g.us';
  await send('.idgroup', { remoteJid: group });
  assert.match(replies.at(-1), /123@g\.us/);
  const count = replies.length;
  await send('.fliptext Venom', { remoteJid: group });
  await send('.idgroup', { remoteJid: group, fromMe: false });
  assert.equal(replies.length, count);
});
