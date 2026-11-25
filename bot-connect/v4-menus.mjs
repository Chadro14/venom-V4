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
  const { data } = await json('https://api.jikan.moe/v4/anime', { q: query, limit: 1, sfw: true });
  const item = data?.[0];
  return answer(item ? `*${item.title}*\n${item.episodes ?? '–'} épisode(s) · Note : ${item.score ?? '–'}\n${(item.synopsis ?? '').slice(0, 1200)}\n${item.url}` : 'Aucun anime trouvé.');
}

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
  ['quotes', { label: 'Citation du jour', async run() {
    const { quote } = await json('https://favqs.com/api/qotd');
    return answer(quote?.body ? `« ${quote.body} »\n— ${quote.author}` : 'Citation indisponible.');
  } }],
  ['wiki', prompt('Chercher sur Wikipédia', '.wiki Kinshasa', wiki)],
  ['weather', prompt('Afficher la météo', '.weather Kinshasa', weather)],
  ['anime', prompt('Trouver la fiche d’un anime', '.anime Naruto', anime)],
  ['itunes', prompt('Chercher un morceau sur Apple Music', '.itunes Naruto', itunes)],
  ['bible', prompt('Chercher un passage biblique', '.bible John 3:16', bible)],
  ['quran', prompt('Lire un verset en français', '.quran 1:1', quran)],
  ['repo', { label: 'Dépôt de Venom V4', run: () => answer('https://github.com/Chadro14/venom-V4') }],
  ['idgroup', { label: 'Afficher l’identifiant du groupe', group: true, run: ({ group, jid }) =>
    answer(group ? `Identifiant du groupe : ${jid}` : 'Utilise .idgroup dans le groupe concerné.') }],
];
