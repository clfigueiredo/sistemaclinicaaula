#!/bin/sh
# Backup diário do Postgres (pg_dump formato custom) + anexos, com retenção de N dias.
#
# Uso (na VPS, a partir do diretório do projeto):
#   ./deploy/backup.sh
# Cron (todo dia às 03:15), ex. em `crontab -e`:
#   15 3 * * * cd /opt/sistema-clinica && ./deploy/backup.sh >> /var/log/clinica-backup.log 2>&1
#
# Variáveis (opcionais): BACKUP_DIR (padrão /var/backups/sistema-clinica), RETENCAO_DIAS (padrão 7),
# ENV_FILE (padrão .env.prod), COMPOSE_FILE (padrão docker-compose.prod.yml).
# Restaurar: veja docs/DEPLOY.md.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/var/backups/sistema-clinica}"
RETENCAO_DIAS="${RETENCAO_DIAS:-7}"
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DATA="$(date +%Y-%m-%d_%H%M)"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

# Banco: usa usuário/banco definidos no próprio container do Postgres.
ARQ_DB="$BACKUP_DIR/banco-$DATA.dump"
compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$ARQ_DB.tmp"
mv "$ARQ_DB.tmp" "$ARQ_DB"

# Anexos (volume "uploads" da API).
ARQ_UP="$BACKUP_DIR/anexos-$DATA.tar.gz"
compose exec -T api tar czf - -C /app/apps/api uploads > "$ARQ_UP.tmp"
mv "$ARQ_UP.tmp" "$ARQ_UP"

# Retenção: apaga backups com mais de RETENCAO_DIAS dias.
find "$BACKUP_DIR" -type f \( -name 'banco-*.dump' -o -name 'anexos-*.tar.gz' \) -mtime +"$((RETENCAO_DIAS - 1))" -delete

echo "$(date -Iseconds) backup ok: $ARQ_DB ($(du -h "$ARQ_DB" | cut -f1)), $ARQ_UP"
