# Venom V4 pour Bot Connect

Ce point d’entrée utilise le registre de commandes de ce dossier. Il expose `.menu`, `.ping`, `.aide` et l’alias `.help` depuis le chat du client avec lui-même.

- Node.js 22 ou plus récent. Depuis la racine du dépôt, installer avec `npm ci --prefix bot-connect` et démarrer avec `node bot-connect/start.mjs`.
- Configurer dans l’hébergement `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (ou `SUPABASE_ANON_KEY`) et `VENOM_WORKER_KEY`. Le worker réutilise l’identifiant Bot Connect `venom`. Faire tourner une seule instance pour cet identifiant.
- Garder `bot-connect/site-sessions/` sur un volume persistant. Avant la bascule, vérifier le lancement du worker, le signal de présence et le jumelage avec un compte de test. Les sources originales du projet restent accessibles dans le dépôt.
- Lancer `npm test --prefix bot-connect` pour vérifier le registre.
