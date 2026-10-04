# Application web AltBoard

API de synchronisation, tableau de bord et export Excel. Documentation du projet : [`../README.md`](../README.md).

```bash
cp .env.example .env.local
npm install
npm run db:migrate
npm run admin:create -- vous@exemple.test
npm run dev
```

| Script | Rôle |
|---|---|
| `npm run dev` / `build` / `start` | serveur de développement, construction, serveur de production |
| `npm run typecheck` / `lint` / `test` | vérifications ; les tests vident la base `wow_altboard_test` |
| `npm run db:generate` | génère une migration après modification de `src/db/schema.ts` |
| `npm run db:migrate` / `db:migrate:test` | applique les migrations |
| `npm run admin:create -- <email>` | crée ou met à jour un compte d'accès |
| `npm run token:create -- "<libellé>"` | crée un jeton d'agent, affiché une seule fois |

Cette version de Next.js diffère des précédentes : lire le guide concerné dans
`node_modules/next/dist/docs/` avant de modifier le code (voir `AGENTS.md`).
