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
# Dossier vide quand le dépôt n'est pas fourni : l'étape « agent » ne publie alors rien.
WORKDIR /agent

# L'agent Windows, offert au téléchargement par la page Machines : publié depuis les sources du
# dépôt. La publication croisée depuis Linux intègre icône, manifeste et version comme sous Windows
# (comparé le 2026-10-29). Copiées plutôt que montées : l'étape reste en cache tant qu'agent/ ne
# change pas, quel que soit le commit.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS agent
ENV DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
WORKDIR /agent
COPY --from=repo /agent/ ./
RUN --mount=type=cache,target=/root/.nuget/packages \
    mkdir -p /out && \
    if [ -f src/AltBoardSync/AltBoardSync.csproj ]; then dotnet publish src/AltBoardSync -c Release -o /out; fi

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Le préfixe d'URL est fixé à la construction (vide sur un sous-domaine dédié).
ARG WOW_BASE_PATH=""
ENV WOW_BASE_PATH=$WOW_BASE_PATH
# L'hôte de production n'a que 4 Go et la publication de l'agent en prend jusqu'à 1 : elle se
# termine avant la construction du site, que BuildKit mènerait sinon en même temps.
RUN --mount=type=bind,from=agent,source=/out,target=/agent-out true
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
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 WOW_MIGRATIONS_DIR=/app/drizzle WOW_AGENT_DIR=/app/agent
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/drizzle ./drizzle
COPY --from=build --chown=app:app /app/migrate.mjs ./migrate.mjs
COPY --from=build --chown=app:app /app/create-admin.mjs ./create-admin.mjs
COPY --from=agent --chown=app:app /out/ ./agent/
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000' + (process.env.WOW_BASE_PATH || '') + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
