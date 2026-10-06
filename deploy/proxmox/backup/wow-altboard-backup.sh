#!/usr/bin/env bash
# Sauvegarde quotidienne de la base wow_altboard, lancée sur le conteneur LXC 102 par
# wow-altboard-backup.timer : pg_dump local avec rotation, puis copie restic hors de l'hôte.
# Installation et restauration : docs/DEPLOYMENT.md, section « Sauvegarde ».
set -euo pipefail

OUT=${WOW_BACKUP_DIR:-/opt/wow-altboard/backups}
KEEP_DAYS=${WOW_BACKUP_KEEP_DAYS:-14}
# Dépôt et mot de passe restic de l'hôte : jamais dans ce dépôt Git.
RESTIC_ENV=${WOW_BACKUP_RESTIC_ENV:-/root/backups/restic/backup-gateway.env}

exec 200> /var/lock/wow-altboard-backup.lock
flock -n 200 || { echo "sauvegarde déjà en cours"; exit 0; }

umask 077
mkdir -p "$OUT"
target="$OUT/wow_altboard-$(date +%Y-%m-%d-%H%M%S).dump"
trap 'rm -f "$target.part"' EXIT

# Écrit à côté puis renommé : un fichier .dump est toujours complet.
docker exec wow-altboard-db pg_dump -U wow_altboard -Fc --no-owner --no-acl wow_altboard > "$target.part"
# Un dump illisible ne doit pas passer pour une sauvegarde.
docker exec -i wow-altboard-db pg_restore --list < "$target.part" > /dev/null
mv "$target.part" "$target"
echo "dump : $target ($(du -h "$target" | cut -f1))"

find "$OUT" -name 'wow_altboard-*.dump' -mtime +"$KEEP_DAYS" -delete

if [ ! -r "$RESTIC_ENV" ]; then
  echo "restic : $RESTIC_ENV absent, pas de copie hors de l'hôte"
  exit 0
fi
set -a
# shellcheck disable=SC1090
. "$RESTIC_ENV"
set +a

# Le dépôt vit sur un hôte qui n'est pas toujours allumé : son absence n'est pas un échec. Tout
# le dossier est envoyé, les dumps des jours manqués partent donc au passage suivant.
if ! timeout 30 restic cat config > /dev/null 2>&1; then
  echo "restic : dépôt injoignable, copie hors de l'hôte reportée"
  exit 0
fi
restic backup --host prox --tag wow-altboard --tag "$(date +%Y-%m-%d)" "$OUT"
echo "restic : copie envoyée"
