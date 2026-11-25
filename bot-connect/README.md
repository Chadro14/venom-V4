# Venom V4 pour Bot Connect

Ce point d’entrée utilise le registre de commandes de ce dossier. Le menu de V4 expose dix catégories et `.allmenu`. Les commandes s’utilisent dans le chat du client avec lui-même. `.groupmenu` et `.idgroup` répondent aussi aux messages émis par le compte jumelé dans un groupe. Les commandes de recherche et de synthèse vocale appellent des services externes. Le menu reprend la présentation de V4 et utilise l’image locale du projet lorsqu’elle est disponible.

- Node.js 22 ou plus récent. Depuis la racine du dépôt, installer avec `npm ci --prefix bot-connect` et démarrer avec `node bot-connect/start.mjs`.
- Configurer dans l’hébergement `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (ou `SUPABASE_ANON_KEY`) et `VENOM_WORKER_KEY`. Le worker réutilise l’identifiant Bot Connect `venom`. Faire tourner une seule instance pour cet identifiant.
- Garder `bot-connect/site-sessions/` sur un volume persistant. Avant la bascule, vérifier le lancement du worker, le signal de présence et le jumelage avec un compte de test. Les sources originales du projet restent accessibles dans le dépôt.
- Pour les stickers, FFmpeg doit être disponible dans le PATH ou via le module du dépôt `@ffmpeg-installer/ffmpeg`. Les images JPEG, PNG et WebP et les vidéos MP4 de neuf secondes au maximum sont acceptées.
- Lancer `npm test --prefix bot-connect` pour vérifier le registre.
