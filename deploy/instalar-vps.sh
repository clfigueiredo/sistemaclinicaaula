#!/usr/bin/env bash
# Instalador do Sistema Clínica numa VPS (Ubuntu/Debian) — só pergunta o DOMÍNIO.
#
# Uso (como root):
#   curl -fsSL https://raw.githubusercontent.com/clfigueiredo/sistemaclinicaaula/main/deploy/instalar-vps.sh | bash
# ou, a partir de um clone do projeto:
#   sudo ./deploy/instalar-vps.sh
#
# O domínio também pode vir por argumento (./deploy/instalar-vps.sh clinica.exemplo.com.br) ou pela
# variável DOMINIO. Antes de rodar, aponte o registro DNS A do domínio para o IP da VPS.
#
# O que faz:
#   1. Instala Docker (se faltar), git, openssl e curl.
#   2. Clona o projeto em /opt/sistema-clinica (ou usa o clone de onde o script foi chamado).
#   3. Gera .env.prod com TODOS os segredos aleatórios (openssl rand -hex 32). Se o .env.prod já existir,
#      mantém os segredos (trocar CHAVE_CRIPTOGRAFIA/senha do Postgres quebraria os dados) e só atualiza o domínio.
#   4. Libera 22/80/443 no ufw (se instalado), sobe o docker-compose.prod.yml e espera a API responder.
#   5. Agenda o backup diário e cria o super admin (se ainda não houver) com senha aleatória
#      (deploy/redefinir-admin.sh — rode-o depois para redefinir a senha).
#
# Variáveis opcionais: DIR_INSTALACAO (padrão /opt/sistema-clinica), REPO_URL, BRANCH (padrão main),
# EMAIL_ACME (padrão admin@DOMINIO), ADMIN_EMAIL (padrão admin@DOMINIO).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/clfigueiredo/sistemaclinicaaula.git}"
BRANCH="${BRANCH:-main}"
DIR_INSTALACAO="${DIR_INSTALACAO:-/opt/sistema-clinica}"
ENV_FILE=".env.prod"
COMPOSE_FILE="docker-compose.prod.yml"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
aviso() { printf '\033[1;33m[aviso]\033[0m %s\n' "$*"; }
erro() { printf '\033[1;31m[erro]\033[0m %s\n' "$*" >&2; exit 1; }
segredo() { openssl rand -hex 32; }

[ "$(id -u)" -eq 0 ] || erro "rode como root (sudo $0)."
command -v apt-get >/dev/null 2>&1 || erro "este instalador suporta apenas Ubuntu/Debian (apt-get)."

# --- 1. Domínio -------------------------------------------------------------------------------------------
DOMINIO="${1:-${DOMINIO:-}}"
if [ -z "$DOMINIO" ]; then
  [ -r /dev/tty ] || erro "sem terminal para perguntar o domínio: passe-o como argumento ou na variável DOMINIO."
  printf 'Domínio do sistema (ex.: clinica.seudominio.com.br): '
  read -r DOMINIO </dev/tty
fi
# Aceita colado com protocolo/barra: "https://Clinica.Exemplo.com/" → "clinica.exemplo.com".
DOMINIO="$(printf '%s' "$DOMINIO" | tr '[:upper:]' '[:lower:]' | sed -E 's#^[a-z]+://##; s#/.*$##; s/[[:space:]]//g')"
printf '%s' "$DOMINIO" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$' \
  || erro "domínio inválido: '$DOMINIO'."
EMAIL_ACME="${EMAIL_ACME:-admin@$DOMINIO}"
ADMIN_EMAIL_INFORMADO="${ADMIN_EMAIL:-}"
info "Domínio: $DOMINIO"

# --- 2. Dependências ----------------------------------------------------------------------------------------
info "Instalando dependências do sistema..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git openssl cron >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  info "Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || erro "plugin 'docker compose' não encontrado."

# DNS: só avisa (o Let's Encrypt falha se o domínio não apontar para esta VPS).
IP_VPS="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
IP_DNS="$(getent ahostsv4 "$DOMINIO" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$IP_DNS" ]; then
  aviso "$DOMINIO ainda não resolve no DNS — o certificado HTTPS só será emitido depois que resolver."
elif [ -n "$IP_VPS" ] && [ "$IP_DNS" != "$IP_VPS" ]; then
  aviso "$DOMINIO aponta para $IP_DNS, mas o IP desta VPS é $IP_VPS. Corrija o registro A."
fi

# --- 3. Código ----------------------------------------------------------------------------------------------
# Executado de um arquivo (não via "curl | bash")? Então usa o clone onde ele está.
DIR_SCRIPT=""
if [ -f "${BASH_SOURCE[0]:-}" ]; then
  DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$DIR_SCRIPT" ] && [ -f "$DIR_SCRIPT/../$COMPOSE_FILE" ]; then
  DIR_INSTALACAO="$(cd "$DIR_SCRIPT/.." && pwd)"
  info "Usando o projeto em $DIR_INSTALACAO"
elif [ -d "$DIR_INSTALACAO/.git" ]; then
  info "Atualizando o projeto em $DIR_INSTALACAO..."
  git -C "$DIR_INSTALACAO" pull --ff-only
else
  info "Clonando o projeto em $DIR_INSTALACAO..."
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR_INSTALACAO"
fi
cd "$DIR_INSTALACAO"

# --- 4. .env.prod -------------------------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  info "$ENV_FILE já existe: segredos mantidos, domínio atualizado."
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  sed -i -E "s#^DOMINIO=.*#DOMINIO=$DOMINIO#; s#^EMAIL_ACME=.*#EMAIL_ACME=$EMAIL_ACME#" "$ENV_FILE"
else
  info "Gerando $ENV_FILE com segredos aleatórios..."
  umask 077
  cat > "$ENV_FILE" <<EOF
# Gerado por deploy/instalar-vps.sh em $(date -Iseconds). NÃO commite; guarde uma cópia fora da VPS.
# NÃO troque CHAVE_CRIPTOGRAFIA nem POSTGRES_PASSWORD depois de em uso (dados ficariam ilegíveis/inacessíveis).
DOMINIO=$DOMINIO
EMAIL_ACME=$EMAIL_ACME
POSTGRES_USER=clinica
POSTGRES_DB=clinica
POSTGRES_PASSWORD=$(segredo)
REDIS_PASSWORD=$(segredo)
JWT_SECRET=$(segredo)
WPPCONNECT_SECRET_KEY=$(segredo)
WEBHOOK_TOKEN=$(segredo)
CHAVE_CRIPTOGRAFIA=$(segredo)
EOF
  umask 022
fi
chmod 600 "$ENV_FILE"

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# --- 5. Firewall e subida -----------------------------------------------------------------------------------
if command -v ufw >/dev/null 2>&1; then
  info "Liberando 22, 80 e 443 no ufw..."
  ufw allow OpenSSH >/dev/null
  ufw allow 80,443/tcp >/dev/null
  ufw allow 443/udp >/dev/null
  ufw --force enable >/dev/null
fi

info "Construindo e subindo os containers (pode levar alguns minutos)..."
# Constrói antes do "up": o worker usa a imagem da API (sistema-clinica-api), que não existe em registry.
compose build api caddy
compose up -d

info "Aguardando a API responder..."
for _ in $(seq 1 60); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3333/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    API_OK=1; break
  fi
  sleep 5
done
[ "${API_OK:-0}" = 1 ] || erro "a API não respondeu em 5 minutos. Veja: docker compose -f $COMPOSE_FILE --env-file $ENV_FILE logs api"

# --- 6. Backup diário ---------------------------------------------------------------------------------------
chmod +x deploy/backup.sh
LINHA_CRON="15 3 * * * cd $DIR_INSTALACAO && ./deploy/backup.sh >> /var/log/clinica-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -vF 'deploy/backup.sh'; echo "$LINHA_CRON" ) | crontab -
systemctl enable --now cron >/dev/null 2>&1 || true

# --- Resumo -------------------------------------------------------------------------------------------------
echo
info "Instalação concluída!"
echo "  Sistema:      https://$DOMINIO"
echo "  Painel admin: https://$DOMINIO/admin/login"
# Cria o super admin só se ainda não houver nenhum (senha aleatória, mostrada aqui e salva em /root).
chmod +x deploy/redefinir-admin.sh
./deploy/redefinir-admin.sh --se-nao-existir ${ADMIN_EMAIL_INFORMADO:+"$ADMIN_EMAIL_INFORMADO"}
echo "  Segredos:     $DIR_INSTALACAO/$ENV_FILE (guarde uma cópia fora da VPS)"
echo "  Backup:       diário às 03:15 em /var/backups/sistema-clinica"
echo
echo "Próximo passo: no painel admin, crie um plano e marque-o como 'plano de cadastro' (sem isso o /cadastro falha)."
