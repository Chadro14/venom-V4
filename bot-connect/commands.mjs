import { execFile } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { additionalCommands } from './v4-menus.mjs';

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
  for (const [section, name] of menuSections) {
    lines.push(`╭─┴❍「 *${section}* 」❍`);
    lines.push(`│ .${name}`);
    lines.push('╰──────❍');
  }
  lines.push('Toutes les commandes · .allmenu');
  const caption = lines.join('\n');
  const image = await readFile(artwork).catch(() => null);
  return image ? { image, caption } : { text: caption };
}

function mediaFormat(bytes) {
  if (bytes.toString('ascii', 4, 8) === 'ftyp') return 'mov';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'mjpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png_pipe';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp_pipe';
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'ogg';
  if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

async function convertMedia(bytes, allowedFormats, extension, options) {
  const format = mediaFormat(bytes);
  if (!allowedFormats.includes(format)) throw new Error('Unsupported media format');
  let binary = 'ffmpeg';
  try {
    binary = require('@ffmpeg-installer/ffmpeg').path;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  const directory = await mkdtemp(join(tmpdir(), 'venom-v4-'));
  const input = join(directory, 'input');
  const output = join(directory, `output.${extension}`);
  try {
    await writeFile(input, bytes);
    await runFile(binary, [
      '-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
      '-protocol_whitelist', 'file,pipe', '-f', format, '-i', input, ...options, output,
    ], { timeout: 18000 });
    return await readFile(output);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function getMedia(body, types) {
  const quoted = (body.extendedTextMessage ?? body.imageMessage ?? body.videoMessage)?.contextInfo?.quotedMessage;
  for (const type of types) {
    const media = body[`${type}Message`] ?? quoted?.[`${type}Message`];
    if (media) return { media, type };
  }
  return {};
}

async function downloadMedia(baileys, media, type) {
  if (Number(media.fileLength) > maxMediaBytes) return null;
  const stream = await baileys.downloadContentFromMessage(media, type);
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > maxMediaBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function sticker({ body, baileys }) {
  const { media, type } = getMedia(body, ['image', 'video']);
  if (!media) return { text: 'Envoie une image ou une vidéo avec .sticker, ou réponds à ce média avec la commande.' };
  const isVideo = type === 'video';
  if (isVideo && Number(media.seconds) > 9) return { text: 'Choisis une vidéo de 9 secondes maximum.' };
  const bytes = await downloadMedia(baileys, media, type);
  if (!bytes) return { text: 'Choisis un média de 8 Mo maximum.' };
  const filter = 'scale=320:320:force_original_aspect_ratio=decrease,pad=320:320:(ow-iw)/2:(oh-ih)/2:color=white@0';
  const buffer = await convertMedia(bytes, isVideo ? ['mov'] : ['mjpeg', 'png_pipe', 'webp_pipe'], 'webp', [
    '-vf', isVideo ? `fps=12,${filter}` : filter, ...(isVideo ? ['-t', '9', '-loop', '0'] : ['-frames:v', '1']),
    '-an', '-c:v', 'libwebp', '-quality', '60',
  ]);
  if (buffer.length > (isVideo ? 500 : 100) * 1024) return { text: 'Choisis un média plus léger pour ce sticker.' };
  return { sticker: buffer };
}

async function audio({ body, baileys }, voice) {
  const { media, type } = getMedia(body, ['video', 'audio']);
  if (!media) return { text: 'Réponds à une vidéo ou à un audio avec la commande.' };
  if (Number(media.seconds) > 120) return { text: 'Choisis un média de 2 minutes maximum.' };
  const bytes = await downloadMedia(baileys, media, type);
  if (!bytes) return { text: 'Choisis un média de 8 Mo maximum.' };
  const buffer = await convertMedia(bytes, ['mov', 'ogg', 'mp3'], voice ? 'ogg' : 'mp3', [
    '-t', '120', '-vn', '-ac', '1', '-c:a', voice ? 'libopus' : 'libmp3lame', '-b:a', '48k',
  ]);
  return { audio: buffer, mimetype: voice ? 'audio/ogg; codecs=opus' : 'audio/mpeg', ...(voice ? { ptt: true } : {}) };
}

async function image({ body, baileys }) {
  const { media, type } = getMedia(body, ['sticker']);
  if (!media) return { text: 'Réponds à un sticker fixe avec .toimg.' };
  const bytes = await downloadMedia(baileys, media, type);
  if (!bytes) return { text: 'Choisis un média de 8 Mo maximum.' };
  return { image: await convertMedia(bytes, ['webp_pipe'], 'png', ['-frames:v', '1']) };
}

const menuSections = [
  ['RECHERCHE', 'searchmenu', ['wiki', 'weather', 'itunes']],
  ['MÉDIAS', 'downloadmenu', ['play', 'toaudio', 'toptt', 'itunes']],
  ['OUTILS', 'toolmenu', ['fliptext', 'styletext', 'ebinary', 'dbinary', 'tts', 'readmore']],
  ['JEUX', 'gamemenu', ['dice', 'math', 'suit']],
  ['DIVERTISSEMENT', 'funmenu', ['truth', 'dare', '8ball', 'rate', 'quotes']],
  ['STICKERS', 'stickermenu', ['sticker', 'toimg']],
  ['ANIME', 'animemenu', ['anime']],
  ['GROUPES', 'groupmenu', ['idgroup']],
  ['RELIGION', 'religionmenu', ['bible', 'quran']],
  ['BOT', 'othermenu', ['ping', 'runtime', 'repo']],
];

function commandList(sections) {
  return { text: sections.map(([label, , names]) =>
    [`╭──❍「 *${label}* 」❍`, ...names.map(name => `│ .${name} · ${commands.get(name).label}`), '╰──────❍'].join('\n')
  ).join('\n') };
}

const commands = new Map([
  ['menu', { label: 'Menu Venom V4', run: menu }],
  ['allmenu', { label: 'Toutes les commandes', run: () => commandList(menuSections) }],
  ...menuSections.map(section => [section[1], {
    label: section[0], group: section[1] === 'groupmenu', run: () => commandList([section]),
  }]),
  ['ping', { label: 'Réponse du bot', run: () => ({ text: '🏓 Pong · Venom V4' }) }],
  ['runtime', { label: 'Temps en ligne', run: () => ({ text: `⏱ Venom V4 est en ligne depuis ${uptime()}.` }) }],
  ['sticker', { label: 'Image ou vidéo vers sticker', media: true, run: sticker }],
  ['toimg', { label: 'Sticker fixe vers image', media: true, run: image }],
  ['toaudio', { label: 'Vidéo ou audio vers MP3', media: true, run: ctx => audio(ctx, false) }],
  ['toptt', { label: 'Vidéo ou audio vers message vocal', media: true, run: ctx => audio(ctx, true) }],
  ['dice', { label: 'Lancer un dé', run: () => ({ text: dice[randomInt(dice.length)] }) }],
  ['readmore', { label: 'Masquer la suite · début | suite', run: ({ args }) => {
    const separator = args.indexOf('|');
    if (separator < 0 || !args.slice(separator + 1).trim()) {
      return { text: 'Exemple : .readmore Début | La suite du message' };
    }
    return { text: args.slice(0, separator).trimEnd() + readMore + args.slice(separator + 1).trimStart() };
  } }],
  ...additionalCommands,
]);

const aliases = new Map([
  ['help', 'menu'], ['alive', 'menu'],
  ['p', 'ping'], ['botstatus', 'ping'], ['statusbot', 'ping'],
  ['s', 'sticker'], ['stiker', 'sticker'],
  ['style', 'styletext'], ['say', 'tts'], ['gtts', 'tts'],
  ['mathquiz', 'math'], ['wikipedia', 'wiki'], ['song', 'play'],
  ['toimage', 'toimg'], ['tomp3', 'toaudio'],
]);

export function bindCommands(socket, baileys, authorized) {
  let converting = false;
  const state = {};
  return async ({ type, messages }) => {
    if (type !== 'notify' || !authorized()) return;
    const normalize = baileys.jidNormalizedUser;
    const own = new Set([socket.user?.id, socket.user?.lid, socket.user?.phoneNumber].filter(Boolean).map(normalize));
    for (const message of messages) {
      if (!authorized()) return;
      const { fromMe, remoteJid, remoteJidAlt } = message.key ?? {};
      if (fromMe !== true || !remoteJid) continue;
      const group = remoteJid.endsWith('@g.us');
      const self = [remoteJid, remoteJidAlt].some(jid => jid && own.has(normalize(jid)));
      if (!group && !self) continue;
      const body = message.message?.ephemeralMessage?.message ?? message.message;
      const text = body?.conversation ?? body?.extendedTextMessage?.text ??
        body?.imageMessage?.caption ?? body?.videoMessage?.caption;
      const match = typeof text === 'string' && /^\.([a-z0-9]+)(?:\s+([\s\S]*))?$/i.exec(text.trim());
      if (!match) continue;
      const input = match[1].toLowerCase();
      const name = aliases.get(input) ?? input;
      const command = commands.get(name);
      if (!command || (group && !command.group) || !authorized()) continue;
      const args = match[2] ?? '';
      if (args.length > 1800) continue;
      if (command.media && converting) continue;
      if (command.media) converting = true;
      try {
        let response;
        try {
          response = await command.run({ args, body, message, baileys, state, group, jid: remoteJid });
        } catch {
          response = { text: command.media ? 'Conversion impossible. Essaie un autre média.' : 'Service momentanément indisponible.' };
        }
        if (authorized()) await socket.sendMessage(remoteJid, response);
      } finally {
        if (command.media) converting = false;
      }
    }
  };
}
