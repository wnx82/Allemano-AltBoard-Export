#!/usr/bin/env bash
# Sauvegarde quotidienne de la base wow_altboard, lancée sur le conteneur LXC 102 par
# wow-altboard-backup.timer : pg_dump local avec rotation, puis copie restic hors de l'hôte.
# Publie son résultat pour Prometheus (collecteur textfile de node_exporter).
# Installation, restauration et alertes : docs/DEPLOYMENT.md.
set -euo pipefail

OUT=${WOW_BACKUP_DIR:-/opt/wow-altboard/backups}
KEEP_DAYS=${WOW_BACKUP_KEEP_DAYS:-14}
# Dépôt et mot de passe restic de l'hôte : jamais dans ce dépôt Git.
RESTIC_ENV=${WOW_BACKUP_RESTIC_ENV:-/root/backups/restic/backup-gateway.env}
# Dossier lu par node_exporter ; vide pour ne rien publier.
METRICS_DIR=${WOW_BACKUP_METRICS_DIR-/var/lib/prometheus/node-exporter}
METRICS_FILE=wow_altboard.prom

exec 200> /var/lock/wow-altboard-backup.lock
flock -n 200 || { echo "sauvegarde déjà en cours"; exit 0; }

# Dernière valeur publiée d'une métrique : la copie hors de l'hôte ne réussit pas à chaque passage.
published() {
  if [ -n "$METRICS_DIR" ] && [ -r "$METRICS_DIR/$METRICS_FILE" ]; then
    awk -v metric="$1" '$1 == metric { print $2 }' "$METRICS_DIR/$METRICS_FILE"
  fi
}

success=0
size=0
offsite=$(published wow_altboard_backup_offsite_last_success_timestamp_seconds)
last_sync=""

metric() {
  printf '# HELP %s %s\n# TYPE %s gauge\n%s %s\n' "$1" "$3" "$1" "$1" "$2"
}

# Appelée à la sortie, quelle qu'elle soit : un échec se lit dans wow_altboard_backup_success.
publish() {
  if [ -z "$METRICS_DIR" ] || [ ! -d "$METRICS_DIR" ]; then return 0; fi
  local draft="$METRICS_DIR/.$METRICS_FILE.$$"
  {
    metric wow_altboard_backup_last_run_timestamp_seconds "$(date +%s)" "Dernier passage de la sauvegarde, reussi ou non."
    metric wow_altboard_backup_success "$success" "1 si le dernier dump est complet et lisible."
    metric wow_altboard_backup_size_bytes "$size" "Taille du dernier dump."
    if [ -n "$offsite" ]; then
      metric wow_altboard_backup_offsite_last_success_timestamp_seconds "$offsite" "Derniere copie restic reussie hors de l'hote."
    fi
    if [ -n "$last_sync" ]; then
      metric wow_altboard_last_sync_timestamp_seconds "$last_sync" "Derniere synchronisation recue d'un agent, tous PC confondus."
    fi
  } > "$draft"
  chmod 644 "$draft"
  mv "$draft" "$METRICS_DIR/$METRICS_FILE"
}

umask 077
mkdir -p "$OUT"
target="$OUT/wow_altboard-$(date +%Y-%m-%d-%H%M%S).dump"
trap 'rm -f "$target.part"; publish || true' EXIT

# Écrit à côté puis renommé : un fichier .dump est toujours complet.
docker exec wow-altboard-db pg_dump -U wow_altboard -Fc --no-owner --no-acl wow_altboard > "$target.part"
# Un dump illisible ne doit pas passer pour une sauvegarde.
docker exec -i wow-altboard-db pg_restore --list < "$target.part" > /dev/null
mv "$target.part" "$target"
success=1
size=$(stat -c %s "$target")
echo "dump : $target ($(du -h "$target" | cut -f1))"

find "$OUT" -name 'wow_altboard-*.dump' -mtime +"$KEEP_DAYS" -delete

# Relevée au même passage : une alerte dont le seuil se compte en jours n'a pas besoin de mieux.
last_sync=$(docker exec wow-altboard-db psql -U wow_altboard -d wow_altboard -Atc \
  "select extract(epoch from max(finished_at))::bigint from sync_runs where status in ('success', 'partial')" || true)

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
offsite=$(date +%s)
echo "restic : copie envoyée"
