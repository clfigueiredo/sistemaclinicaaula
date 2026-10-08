#!/usr/bin/env bash
# Instalador do Sistema Clínica numa VPS (Ubuntu/Debian) — só pergunta os DOMÍNIOS.
#
# Uso (como root):
#   curl -fsSL https://raw.githubusercontent.com/clfigueiredo/sistemaclinicaaula/main/deploy/instalar-vps.sh | bash
# ou, a partir de um clone do projeto:
#   sudo ./deploy/instalar-vps.sh
#
# Três domínios, cada um com um registro DNS A apontando para a VPS:
#   landing page (ex.: seudominio.com.br), painel da clínica (sugestão: app.seudominio.com.br) e painel do
#   administrador — planos, clínicas e cobrança (sugestão: admin.seudominio.com.br).
# Também podem vir por argumento (./deploy/instalar-vps.sh site.com app.site.com admin.site.com) ou pelas
# variáveis DOMINIO_SITE, DOMINIO_APP e DOMINIO_ADMIN.
#
# O que faz:
#   1. Instala Docker (se faltar), git, openssl e curl.
#   2. Clona o projeto em /opt/sistema-clinica (ou usa o clone de onde o script foi chamado).
#   3. Gera .env.prod com TODOS os segredos aleatórios (openssl rand -hex 32). Se o .env.prod já existir,
#      mantém os segredos (trocar CHAVE_CRIPTOGRAFIA/senha do Postgres quebraria os dados) e só atualiza os domínios.
#   4. Libera 22/80/443 no ufw (se instalado), sobe o docker-compose.prod.yml e espera a API responder.
#   5. Agenda o backup diário e prepara o banco (deploy/acessos.sh): recursos, planos (com o de cadastro),
#      super admin e a clínica "Minha Clínica" com usuário admin — senhas aleatórias, mostradas no fim e
#      salvas em ACESSOS.txt na raiz do projeto. Novas senhas: ./deploy/acessos.sh --redefinir
#   A landing page de teste fica em landing/ (editável na VPS sem rebuild).
#
# Variáveis opcionais: DIR_INSTALACAO (padrão /opt/sistema-clinica), REPO_URL, BRANCH (padrão main),
# EMAIL_ACME (padrão admin@DOMINIO_SITE).
set -euo pipefail

# Tudo dentro de main(): com "curl ... | bash" o bash lê o script pelo stdin enquanto executa, e qualquer comando
# que leia o stdin (ex.: docker compose exec) engoliria o resto do script. Assim o arquivo é lido inteiro antes.
main() {

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

# --- 1. Domínios -----------------------------------------------------------------------------------------
# Executado de um arquivo (não via "curl | bash")? Então usa o clone onde ele está.
DIR_SCRIPT=""
if [ -f "${BASH_SOURCE[0]:-}" ]; then
  DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -n "$DIR_SCRIPT" ] && [ -f "$DIR_SCRIPT/../$COMPOSE_FILE" ]; then
  DIR_INSTALACAO="$(cd "$DIR_SCRIPT/.." && pwd)"
fi

# Reinstalação: sugere os domínios já configurados.
valor_env() { [ -f "$DIR_INSTALACAO/$ENV_FILE" ] && grep -E "^$1=" "$DIR_INSTALACAO/$ENV_FILE" | tail -n1 | cut -d= -f2- || true; }
normalizar() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#^[a-z]+://##; s#/.*$##; s/[[:space:]]//g'; }
valido() { printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$'; }
# perguntar VAR "Texto" "sugestão" — usa o valor já definido (argumento/variável) ou pergunta no terminal.
perguntar() {
  local var="$1" texto="$2" sugestao="$3" valor="${!1:-}"
  while :; do
    if [ -z "$valor" ]; then
      [ -r /dev/tty ] || erro "sem terminal para perguntar: defina a variável $var (ou passe os domínios como argumentos)."
      if [ -n "$sugestao" ]; then printf '%s [%s]: ' "$texto" "$sugestao"; else printf '%s: ' "$texto"; fi
      read -r valor </dev/tty
      [ -n "$valor" ] || valor="$sugestao"
    fi
    valor="$(normalizar "$valor")"
    if valido "$valor"; then printf -v "$var" '%s' "$valor"; return; fi
    aviso "domínio inválido: '$valor'."
    valor=""
  done
}

DOMINIO_SITE="${1:-${DOMINIO_SITE:-}}"
DOMINIO_APP="${2:-${DOMINIO_APP:-}}"
DOMINIO_ADMIN="${3:-${DOMINIO_ADMIN:-}}"
echo
echo "O sistema usa três endereços (crie um registro DNS A para cada um, apontando para esta VPS):"
echo "  1) landing page   2) painel da clínica   3) painel do administrador (planos e clínicas)"
echo
perguntar DOMINIO_SITE "Domínio da landing page (ex.: seudominio.com.br)" "$(valor_env DOMINIO_SITE)"
SUGESTAO_BASE="${DOMINIO_SITE#www.}"
SUGESTAO_APP="$(valor_env DOMINIO_APP)"; SUGESTAO_APP="${SUGESTAO_APP:-app.$SUGESTAO_BASE}"
SUGESTAO_ADMIN="$(valor_env DOMINIO_ADMIN)"; SUGESTAO_ADMIN="${SUGESTAO_ADMIN:-admin.$SUGESTAO_BASE}"
perguntar DOMINIO_APP "Domínio do painel da clínica" "$SUGESTAO_APP"
perguntar DOMINIO_ADMIN "Domínio do painel do administrador" "$SUGESTAO_ADMIN"
if [ "$DOMINIO_SITE" = "$DOMINIO_APP" ] || [ "$DOMINIO_SITE" = "$DOMINIO_ADMIN" ] || [ "$DOMINIO_APP" = "$DOMINIO_ADMIN" ]; then
  erro "os três domínios precisam ser diferentes (ex.: seudominio.com.br, app.seudominio.com.br, admin.seudominio.com.br)."
fi
EMAIL_ACME="${EMAIL_ACME:-admin@$DOMINIO_SITE}"
info "Landing page:        https://$DOMINIO_SITE"
info "Painel da clínica:   https://$DOMINIO_APP"
info "Painel do admin:     https://$DOMINIO_ADMIN"

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

# DNS: só avisa (o Let's Encrypt falha para o domínio que não apontar para esta VPS).
IP_VPS="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
for dominio in "$DOMINIO_SITE" "$DOMINIO_APP" "$DOMINIO_ADMIN"; do
  IP_DNS="$(getent ahostsv4 "$dominio" 2>/dev/null | awk 'NR==1{print $1}' || true)"
  if [ -z "$IP_DNS" ]; then
    aviso "$dominio ainda não resolve no DNS — o HTTPS dele só será emitido depois que resolver."
  elif [ -n "$IP_VPS" ] && [ "$IP_DNS" != "$IP_VPS" ]; then
    aviso "$dominio aponta para $IP_DNS, mas o IP desta VPS é $IP_VPS. Corrija o registro A."
  fi
done

# --- 3. Código ----------------------------------------------------------------------------------------------
if [ -n "$DIR_SCRIPT" ] && [ -f "$DIR_SCRIPT/../$COMPOSE_FILE" ]; then
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
# definir_env CHAVE valor — troca a linha existente ou acrescenta no fim.
definir_env() {
  if grep -qE "^$1=" "$ENV_FILE"; then sed -i -E "s#^$1=.*#$1=$2#" "$ENV_FILE"; else printf '%s=%s
' "$1" "$2" >> "$ENV_FILE"; fi
}
if [ -f "$ENV_FILE" ]; then
  info "$ENV_FILE já existe: segredos mantidos, domínios atualizados."
  cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
  sed -i -E '/^DOMINIO=/d' "$ENV_FILE"   # versão antiga, com domínio único
else
  info "Gerando $ENV_FILE com segredos aleatórios..."
  umask 077
  cat > "$ENV_FILE" <<EOF
# Gerado por deploy/instalar-vps.sh em $(date -Iseconds). NÃO commite; guarde uma cópia fora da VPS.
# NÃO troque CHAVE_CRIPTOGRAFIA nem POSTGRES_PASSWORD depois de em uso (dados ficariam ilegíveis/inacessíveis).
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
definir_env DOMINIO_SITE "$DOMINIO_SITE"
definir_env DOMINIO_APP "$DOMINIO_APP"
definir_env DOMINIO_ADMIN "$DOMINIO_ADMIN"
definir_env EMAIL_ACME "$EMAIL_ACME"
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
# Rede instável com o Docker Hub (timeout no download) é comum: cada etapa tenta até 3 vezes.
tentar() {
  local n
  for n in 1 2 3; do
    "$@" && return 0
    [ "$n" -lt 3 ] && { aviso "falhou (tentativa $n de 3) — tentando de novo em 15 s..."; sleep 15; }
  done
  erro "não foi possível concluir: $*"
}
tentar compose pull --quiet postgres redis wppconnect
tentar compose build --pull api caddy
tentar compose up -d

info "Aguardando a API responder..."
for _ in $(seq 1 60); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:3333/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" </dev/null >/dev/null 2>&1; then
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

# --- 7. Banco inicial e acessos ----------------------------------------------------------------------------
# Recursos, planos (com o de cadastro), super admin e "Minha Clínica" — senhas aleatórias, salvas em ACESSOS.txt.
chmod +x deploy/acessos.sh
info "Preparando o banco e os acessos..."
./deploy/acessos.sh </dev/null

# --- Resumo -------------------------------------------------------------------------------------------------
echo
info "Instalação concluída!"
echo "  Landing page:       https://$DOMINIO_SITE   (arquivos em $DIR_INSTALACAO/landing)"
echo "  Painel da clínica:  https://$DOMINIO_APP"
echo "  Painel do admin:    https://$DOMINIO_ADMIN"
echo "  Segredos:           $DIR_INSTALACAO/$ENV_FILE (guarde uma cópia fora da VPS)"
echo "  Backup:             diário às 03:15 em /var/backups/sistema-clinica"
echo "  Acessos:            $DIR_INSTALACAO/ACESSOS.txt  (ver de novo: cat $DIR_INSTALACAO/ACESSOS.txt)"
echo
echo "Os acessos dos dois painéis estão no quadro acima. Se o HTTPS ainda não abrir, aguarde o DNS propagar."
}

main "$@"
