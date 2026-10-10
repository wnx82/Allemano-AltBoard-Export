# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Le dépôt, hors du contexte de construction (web/) : le commit extrait et la version de l'agent,
# affichés en pied de page, s'y lisent. Remplacé par le contexte nommé « repo » quand la construction
# le fournit (deploy/proxmox/compose.yaml) ; vide sinon, et ces deux valeurs ne sont pas affichées.
FROM scratch AS repo

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le préfixe d'URL est fixé à la construction (vide sur un sous-domaine dédié).
ARG WOW_BASE_PATH=""
ENV WOW_BASE_PATH=$WOW_BASE_PATH
# Aucune base n'est nécessaire pour construire : toutes les pages sont rendues à la demande.
RUN --mount=type=bind,from=repo,target=/repo WOW_REPO_DIR=/repo npm run build
# Script de migration autonome, pour appliquer le schéma depuis l'image elle-même.
RUN npx esbuild src/db/migrate.ts --bundle --platform=node --format=esm --external:pg-native \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=migrate.mjs
# Création du compte d'accès depuis l'image : le mot de passe est saisi sur le serveur, sans écho.
RUN npx esbuild scripts/create-admin.ts --bundle --platform=node --format=esm --external:pg-native \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
      --outfile=create-admin.mjs

FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 WOW_MIGRATIONS_DIR=/app/drizzle
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/migrate.mjs ./migrate.mjs
COPY --from=build --chown=app:app /app/create-admin.mjs ./create-admin.mjs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000' + (process.env.WOW_BASE_PATH || '') + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
