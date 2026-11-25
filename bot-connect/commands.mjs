import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const require = createRequire(import.meta.url);
const artwork = new URL('../XliconMedia/theme/XliconPic.jpg', import.meta.url);
const maxMediaBytes = 8 * 1024 * 1024;
const dice = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const readMore = '\u200e'.repeat(4001);

function uptime() {
  const seconds = Math.floor(process.uptime());
  return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds / 60) % 60} min ${seconds % 60} s`;
}

async function menu({ message }) {
  const name = String(message.pushName || 'Salut').trim().slice(0, 48);
  const lines = [
    '╭──❍「 *VENOM V4* 」❍',
    `├ 👋 ${name}`,
    `├ En ligne depuis ${uptime()}`,
    '╰─┬────❍',
  ];
  for (const [section, names] of menuSections) {
    lines.push(`╭─┴❍「 *${section}* 」❍`);
    for (const name of names) lines.push(`│ .${name} · ${commands.get(name).label}`);
    lines.push('╰──────❍');
  }
  const caption = lines.join('\n');
  const image = await readFile(artwork).catch(() => null);
  return image ? { image, caption } : { text: caption };
}

async function convertSticker(bytes, video) {
  const format = video
    ? (bytes.toString('ascii', 4, 8) === 'ftyp' ? 'mov' : null)
    : bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'mjpeg'
      : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'png_pipe'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp_pipe'
          : null;
  if (!format) throw new Error('Unsupported sticker media format');
  let binary = 'ffmpeg';
  try {
    binary = require('@ffmpeg-installer/ffmpeg').path;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), 'venom-v4-'));
  const input = join(directory, 'input');
  const output = join(directory, 'sticker.webp');
  const filter = 'scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=white@0';
  try {
    await writeFile(input, bytes);
    await runFile(binary, [
      '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
      '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input,
      '-vf', video ? `fps=12,${filter}` : filter,
      ...(video ? ['-t', '9', '-loop', '0'] : ['-frames:v', '1']),
      '-an', '-c:v', 'libwebp', '-quality', '60', output,
    ], { timeout: 18000 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function sticker({ body, baileys }) {
  const quoted = body.extendedTextMessage?.contextInfo?.quotedMessage;
  const media = body.imageMessage ?? body.videoMessage ?? quoted?.imageMessage ?? quoted?.videoMessage;
  if (!media) return { text: 'Envoie une image ou une vidéo avec .sticker, ou réponds à ce média avec la commande.' };
  const isVideo = Boolean(body.videoMessage === media || quoted?.videoMessage === media);
  if (isVideo && Number(media.seconds) > 9) return { text: 'Choisis une vidéo de 9 secondes maximum.' };
  if (Number(media.fileLength) > maxMediaBytes) return { text: 'Choisis un média de 8 Mo maximum.' };
  const stream = await baileys.downloadContentFromMessage(media, isVideo ? 'video' : 'image');
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxMediaBytes) return { text: 'Choisis un média de 8 Mo maximum.' };
    chunks.push(chunk);
  }
  const buffer = await convertSticker(Buffer.concat(chunks, size), isVideo);
  if (buffer.length > (isVideo ? 500 : 100) * 1024) return { text: 'Choisis un média plus léger pour ce sticker.' };
  return { sticker: buffer };
}

const menuSections = [
  ['BOT', ['menu', 'ping', 'runtime']],
  ['STICKERS', ['sticker']],
  ['JEUX ET TEXTE', ['dice', 'readmore']],
];

const commands = new Map([
  ['menu', { label: 'Menu Venom V4', run: menu }],
  ['ping', { label: 'Réponse du bot', run: () => ({ text: '🏓 Pong · Venom V4' }) }],
  ['runtime', { label: 'Temps en ligne', run: () => ({ text: `⏱ Venom V4 est en ligne depuis ${uptime()}.` }) }],
  ['sticker', { label: 'Image ou vidéo vers sticker', run: sticker }],
  ['dice', { label: 'Lancer un dé', run: () => ({ text: dice[randomInt(dice.length)] }) }],
  ['readmore', { label: 'Masquer la suite · début | suite', run: ({ args }) => {
    const separator = args.indexOf('|');
    if (separator < 0 || !args.slice(separator + 1).trim()) {
      return { text: 'Exemple : .readmore Début | La suite du message' };
    }
    return { text: args.slice(0, separator).trimEnd() + readMore + args.slice(separator + 1).trimStart() };
  } }],
]);

const aliases = new Map([
  ['help', 'menu'], ['alive', 'menu'],
  ['p', 'ping'], ['botstatus', 'ping'], ['statusbot', 'ping'],
  ['s', 'sticker'], ['stiker', 'sticker'],
]);

export function bindCommands(socket, baileys, authorized) {
  let makingSticker = false;
  return async ({ type, messages }) => {
    if (type !== 'notify' || !authorized()) return;
    const normalize = baileys.jidNormalizedUser;
    const own = new Set([socket.user?.id, socket.user?.lid, socket.user?.phoneNumber].filter(Boolean).map(normalize));
    for (const message of messages) {
      if (!authorized()) return;
      const { fromMe, remoteJid, remoteJidAlt } = message.key ?? {};
      if (fromMe !== true || !remoteJid ||
          ![remoteJid, remoteJidAlt].some(jid => jid && own.has(normalize(jid)))) continue;
      const body = message.message?.ephemeralMessage?.message ?? message.message;
      const text = body?.conversation ?? body?.extendedTextMessage?.text ??
        body?.imageMessage?.caption ?? body?.videoMessage?.caption;
      const match = typeof text === 'string' && /^\.([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
      if (!match) continue;
      const input = match[1].toLowerCase();
      const name = aliases.get(input) ?? input;
      const command = commands.get(name);
      if (!command || !authorized()) continue;
      const args = match[2] ?? '';
      if (args.length > 1800) continue;
      if (name === 'sticker' && makingSticker) continue;
      if (name === 'sticker') makingSticker = true;
      try {
        let response;
        try {
          response = await command.run({ args, body, message, baileys });
        } catch (error) {
          if (name !== 'sticker') throw error;
          response = { text: 'Conversion impossible. Essaie un autre média.' };
        }
        if (authorized()) await socket.sendMessage(remoteJid, response);
      } finally {
        if (name === 'sticker') makingSticker = false;
      }
    }
  };
}
