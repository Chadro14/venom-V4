const commands = new Map([
  ['menu', {
    label: 'Afficher les commandes',
    run: () => ['*VENOM V4 · Bot Connect*', ...[...commands].map(([name, { label }]) => `.${name} — ${label}`)].join('\n'),
  }],
  ['ping', { label: 'Vérifier la connexion', run: () => 'Pong · Venom V4' }],
  ['aide', { label: 'Obtenir de l’aide', run: () => 'Pour retrouver ton jumelage ou demander de l’aide : https://bot-connect.ink-drop.app/' }],
]);

const aliases = new Map([['help', 'aide']]);

export function bindCommands(socket, baileys, authorized) {
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
      const text = body?.conversation ?? body?.extendedTextMessage?.text;
      const name = typeof text === 'string' ? /^\.([a-z]+)$/i.exec(text.trim())?.[1]?.toLowerCase() : undefined;
      if (!name) continue;
      const command = commands.get(aliases.get(name) ?? name);
      if (command && authorized()) await socket.sendMessage(remoteJid, { text: command.run() });
    }
  };
}
