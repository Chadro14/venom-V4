import { randomInt } from 'node:crypto';

const answer = text => ({ text });
const pick = items => items[randomInt(items.length)];
const prompt = (label, example, run) => ({
  label,
  run: ctx => ctx.args.trim() ? run(ctx.args.trim(), ctx) : answer(`Exemple : ${example}`),
});

async function json(base, params = {}) {
  const url = new URL(base);
  url.search = new URLSearchParams(params);
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Venom-V4-Bot-Connect/1.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Provider HTTP ${response.status}`);
  return response.json();
}

const answers = ['Oui.', 'Non.', 'Probablement.', 'Repose-moi la question plus tard.'];
const levels = { noob: 10, easy: 20, medium: 50, hard: 100 };
const suits = ['pierre', 'papier', 'ciseaux'];
const truths = ['Quel projet te rend le plus fier ?', 'Quelle compétence aimerais-tu apprendre ?', 'Quelle série pourrais-tu revoir sans te lasser ?'];
const dares = ['Dessine un personnage les yeux fermés.', 'Invente un titre pour ton autobiographie.', 'Résume ton film préféré en trois mots.'];
const facts = [
  'La lumière du Soleil met environ huit minutes à atteindre la Terre.',
  'Une pieuvre possède trois cœurs.',
  'Vénus tourne sur elle-même plus lentement qu’elle ne fait le tour du Soleil.',
];
const questionReplies = {
  can: answers,
  is: answers,
  when: ['Demain.', 'Dans quelques jours.', 'Au bon moment.'],
  where: ['Plus près que tu ne le penses.', 'À la prochaine étape de ton voyage.', 'Là où tu regarderas en premier.'],
  what: ['Une surprise.', 'Une bonne question.', 'Quelque chose d’inattendu.'],
  how: ['Un pas à la fois.', 'En commençant par le plus simple.', 'Avec un peu de patience.'],
};

async function animalPhoto(kind) {
  const providers = {
    cat: { api: 'https://api.thecatapi.com/v1/images/search', host: 'cdn2.thecatapi.com' },
    dog: { api: 'https://dog.ceo/api/breeds/image/random', host: 'images.dog.ceo' },
  };
  const { api, host } = providers[kind];
  const payload = await json(api);
  const source = Array.isArray(payload) ? payload[0]?.url : payload.message;
  return publicImage(source, host);
}

async function publicImage(source, host) {
  const url = new URL(source);
  if (url.origin !== `https://${host}` || url.username || url.password) throw new Error('Image source not allowed');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('image/') || !response.body) {
    throw new Error('Image unavailable');
  }
  const chunks = [];
  let size = 0;
  for await (const part of response.body) {
    size += part.length;
    if (size > 4 * 1024 * 1024) throw new Error('Image too large');
    chunks.push(part);
  }
  return { image: Buffer.concat(chunks, size) };
}

function quiz({ args, state }) {
  const input = args.trim().toLowerCase();
  if (input in levels && Object.hasOwn(levels, input)) {
    const max = levels[input];
    const a = randomInt(1, max);
    const b = randomInt(1, max);
    state.math = { answer: a + b, expires: Date.now() + 60000 };
    return answer(`Combien font ${a} + ${b} ? Réponds avec .math suivi du résultat.`);
  }
  if (!/^\d+$/.test(input) || !state.math || state.math.expires < Date.now()) {
    return answer('Choisis un mode : .math noob, .math easy, .math medium ou .math hard.');
  }
  if (Number(input) !== state.math.answer) return answer('Essaie encore.');
  delete state.math;
  return answer('Bonne réponse !');
}

function decodeBinary(input) {
  const bytes = input.split(/\s+/);
  if (!bytes.every(bit => /^[01]{8}$/.test(bit))) return answer('Envoie des octets de 8 bits séparés par des espaces.');
  return answer(Buffer.from(bytes.map(bit => Number.parseInt(bit, 2))).toString('utf8'));
}

async function wiki(query) {
  const data = await json('https://fr.wikipedia.org/w/api.php', {
    action: 'query', generator: 'search', gsrsearch: query, gsrlimit: 1,
    prop: 'extracts', exintro: 1, explaintext: 1, format: 'json', formatversion: 2,
  });
  const page = data.query?.pages?.[0];
  return answer(page?.extract
    ? `*${page.title}*\n${page.extract.slice(0, 1800)}\nhttps://fr.wikipedia.org/?curid=${page.pageid}`
    : 'Aucun article trouvé.');
}

async function anime(query) {
  const item = await animeLookup(
    'Media(search:$name, type:ANIME, isAdult:false){title{romaji} episodes averageScore siteUrl description(asHtml:false)}',
    query,
  );
  const synopsis = (item?.description ?? '').replace(/<[^>]*>/g, ' ').trim().slice(0, 1200);
  return answer(item ? `*${item.title.romaji}*\n${item.episodes ?? '–'} épisode(s) · Note : ${item.averageScore ?? '–'}/100\n${synopsis}\n${item.siteUrl}` : 'Aucun anime trouvé.');
}

async function animeLookup(selection, name, result = 'Media') {
  const response = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: `query($name: String!){${selection}}`,
      variables: { name },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Anime provider HTTP ${response.status}`);
  return (await response.json()).data?.[result] ?? null;
}

const animeCharacters = {
  naruto: ['Naruto Uzumaki', 'Naruto'],
  boruto: ['Boruto Uzumaki', 'Boruto: Naruto Next Generations'],
  asuna: ['Asuna Yuuki', 'Sword Art Online'],
  deidara: ['Deidara', 'Naruto Shippuden'],
  erza: ['Erza Scarlet', 'Fairy Tail'],
  itachi: ['Itachi Uchiha', 'Naruto Shippuden'],
  kakasih: ['Kakashi Hatake', 'Naruto'],
  mikasa: ['Mikasa Ackerman', 'Shingeki no Kyojin'],
  minato: ['Minato Namikaze', 'Naruto Shippuden'],
  sakura: ['Sakura Haruno', 'Naruto'],
  sasuke: ['Sasuke Uchiha', 'Naruto'],
  madara: ['Madara Uchiha', 'Naruto Shippuden'],
  mikey: ['Manjirou Sano', 'Tokyo Revengers'],
  kurumi: ['Kurumi Tokisaki', 'Date A Live'],
  nezuko: ['Nezuko Kamado', 'Kimetsu no Yaiba'],
  keneki: ['Ken Kaneki', 'Tokyo Ghoul'],
  kagura: ['Kagura', 'Gintama'],
  doraemon: ['Doraemon', 'Doraemon'],
  emilia: ['Emilia', 'Re:Zero'],
};

export const characterCommands = Object.entries(animeCharacters).map(([name, [fullName, series]]) => [
  name, { label: fullName, async run() {
    const item = await animeLookup(
      'Character(search:$name){name{full} siteUrl image{large}}',
      fullName,
      'Character',
    );
    if (!item) return answer('Fiche anime introuvable.');
    const caption = `*${fullName}*\nAnime : ${series}\n${item.siteUrl}`;
    const image = item.image?.large
      ? await publicImage(item.image.large, 's4.anilist.co').catch(() => null)
      : null;
    return image ? { ...image, caption } : answer(caption);
  } },
]);

async function weather(query) {
  const locations = await json('https://geocoding-api.open-meteo.com/v1/search', { name: query, count: 1, language: 'fr' });
  const place = locations.results?.[0];
  if (!place) return answer('Ville introuvable.');
  const { current } = await json('https://api.open-meteo.com/v1/forecast', {
    latitude: place.latitude, longitude: place.longitude,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m',
  });
  if (!current) return answer('Météo indisponible.');
  return answer(`*${place.name}, ${place.country}*\n🌡 ${current.temperature_2m} °C (ressenti ${current.apparent_temperature} °C)\n💧 ${current.relative_humidity_2m} % · Vent ${current.wind_speed_10m} km/h`);
}

async function tts(text) {
  const url = new URL('https://translate.google.com/translate_tts');
  url.search = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl: 'fr', q: text.slice(0, 180) });
  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/')) throw new Error('TTS indisponible');
  return { audio: Buffer.from(await response.arrayBuffer()), mimetype: 'audio/mpeg' };
}

async function itunes(query) {
  const { results } = await json('https://itunes.apple.com/search', { term: query, entity: 'song', limit: 3 });
  return answer(results?.length
    ? results.map(item => `*${item.trackName}* · ${item.artistName}\n${item.trackViewUrl}`).join('\n\n')
    : 'Aucun morceau trouvé.');
}

async function play(query) {
  const { results } = await json('https://itunes.apple.com/search', { term: query, entity: 'song', limit: 4 });
  const track = results?.find(item => item.previewUrl);
  if (!track) return answer('Aucun extrait audio trouvé.');
  const url = new URL(track.previewUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.itunes.apple.com') || url.username || url.password || url.port) {
    throw new Error('Unexpected preview source');
  }
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get('content-type')?.startsWith('audio/') || !response.body) {
    throw new Error('Preview unavailable');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('Preview too large');
    chunks.push(chunk);
  }
  return { audio: Buffer.concat(chunks, size), mimetype: 'audio/mp4' };
}

async function bible(reference) {
  const { text, reference: title } = await json(`https://bible-api.com/${encodeURIComponent(reference)}`);
  return answer(text ? `*${title}*\n${text.trim().slice(0, 2000)}` : 'Passage introuvable.');
}

async function quran(reference) {
  if (!/^\d{1,3}:\d{1,3}$/.test(reference)) return answer('Exemple : .quran 1:1');
  const { data } = await json(`https://api.alquran.cloud/v1/ayah/${reference}/fr.hamidullah`);
  return answer(data?.text ? `*${data.surah.englishName} ${reference}*\n${data.text}` : 'Verset introuvable.');
}

export const additionalCommands = [
  ['fliptext', prompt('Inverser un texte', '.fliptext Venom', text => answer([...text].reverse().join('')))],
  ['styletext', prompt('Mettre un texte en style', '.styletext Venom', text => answer(
    [...text].map(char => {
      if (/^[A-Z]$/.test(char)) return String.fromCodePoint(0x1d400 + char.charCodeAt(0) - 65);
      if (/^[a-z]$/.test(char)) return String.fromCodePoint(0x1d41a + char.charCodeAt(0) - 97);
      return char;
    }).join('')
  ))],
  ['ebinary', prompt('Encoder un texte en binaire', '.ebinary Salut', text => answer(
    [...Buffer.from(text.slice(0, 240))].map(byte => byte.toString(2).padStart(8, '0')).join(' ')
  ))],
  ['dbinary', prompt('Décoder du binaire', '.dbinary 01000001', decodeBinary)],
  ['tts', prompt('Lire un texte en audio en français', '.tts Bonjour', tts)],
  ['math', { label: 'Quiz de calcul', run: quiz }],
  ['suit', prompt('Pierre-papier-ciseaux contre le bot', '.suit pierre', text => {
    const move = suits.indexOf(text.toLowerCase());
    if (move < 0) return answer('Choisis pierre, papier ou ciseaux.');
    const rival = randomInt(3);
    return answer(`Venom joue ${suits[rival]}. ${['Égalité !', 'Bravo, tu gagnes !', 'Venom gagne !'][(move - rival + 3) % 3]}`);
  })],
  ['truth', { label: 'Question vérité', run: () => answer(pick(truths)) }],
  ['dare', { label: 'Tirer un défi', run: () => answer(pick(dares)) }],
  ['8ball', prompt('Poser une question au hasard', '.8ball Vais-je réussir ?', () => answer(pick(answers)))],
  ['rate', prompt('Donner une note au hasard', '.rate mon dessin', text => answer(`${text} · ${randomInt(101)}/100`))],
  ['fact', { label: 'Afficher un fait au hasard', run: () => answer(pick(facts)) }],
  ['pick', prompt('Choisir entre plusieurs options', '.pick manga | anime', text => {
    const values = text.split('|').map(value => value.trim()).filter(Boolean);
    return answer(values.length > 1 ? pick(values) : 'Sépare au moins deux choix avec |.');
  })],
  ...Object.entries(questionReplies).map(([name, replies]) => [
    name, prompt('Réponse aléatoire pour jouer', `.${name} ta question`, () => answer(pick(replies))),
  ]),
  ['quotes', { label: 'Citation du jour', async run() {
    const { quote } = await json('https://favqs.com/api/qotd');
    return answer(quote?.body ? `« ${quote.body} »\n— ${quote.author}` : 'Citation indisponible.');
  } }],
  ['wiki', prompt('Chercher sur Wikipédia', '.wiki Kinshasa', wiki)],
  ['google', prompt('Ouvrir une recherche Google', '.google Kinshasa', query =>
    answer(`https://www.google.com/search?${new URLSearchParams({ q: query })}`))],
  ['ytsearch', prompt('Ouvrir une recherche YouTube', '.ytsearch Naruto', query =>
    answer(`https://www.youtube.com/results?${new URLSearchParams({ search_query: query })}`))],
  ['weather', prompt('Afficher la météo', '.weather Kinshasa', weather)],
  ['anime', prompt('Trouver la fiche d’un anime', '.anime Naruto', anime)],
  ['itunes', prompt('Chercher un morceau sur Apple Music', '.itunes Naruto', itunes)],
  ['play', prompt('Écouter un extrait Apple Music', '.play Naruto', play)],
  ['bible', prompt('Chercher un passage biblique', '.bible John 3:16', bible)],
  ['quran', prompt('Lire un verset en français', '.quran 1:1', quran)],
  ['repo', { label: 'Dépôt de Venom V4', run: () => answer('https://github.com/Chadro14/venom-V4') }],
  ['tagme', { label: 'Se mentionner', run: ({ jid }) => ({ text: `@${jid.split('@')[0]}`, mentions: [jid] }) }],
  ['react', { label: 'Réagir à un message cité', run: ({ args, body, jid }) => {
    const text = args.trim();
    const id = body.extendedTextMessage?.contextInfo?.stanzaId;
    if (!id || !/^\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?$/u.test(text)) {
      return answer('Réponds à un message avec .react suivi d’un emoji, par exemple .react 👍.');
    }
    return { react: { text, key: { remoteJid: jid, id, fromMe: true } } };
  } }],
  ['q', { label: 'Relire un texte cité', run: ({ body }) => {
    const quoted = body.extendedTextMessage?.contextInfo?.quotedMessage;
    const text = quoted?.conversation ?? quoted?.extendedTextMessage?.text;
    return answer(text?.slice(0, 1800) || 'Réponds à un message texte avec .q.');
  } }],
  ['catmeow', { label: 'Photo aléatoire de chat', run: () => animalPhoto('cat') }],
  ['dogwoof', { label: 'Photo aléatoire de chien', run: () => animalPhoto('dog') }],
  ['idgroup', { label: 'Afficher l’identifiant du groupe', group: true, run: ({ group, jid }) =>
    answer(group ? `Identifiant du groupe : ${jid}` : 'Utilise .idgroup dans le groupe concerné.') }],
];
