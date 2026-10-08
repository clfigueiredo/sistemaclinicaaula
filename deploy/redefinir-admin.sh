#!/usr/bin/env bash
# Cria o super admin ou redefine a senha dele, com senha aleatória.
#
# Uso (na VPS, como root, dentro de /opt/sistema-clinica):
#   ./deploy/redefinir-admin.sh                      # redefine a senha do super admin (cria se não houver)
#   ./deploy/redefinir-admin.sh email@dominio.com    # idem, para esse e-mail
#   ./deploy/redefinir-admin.sh --se-nao-existir     # só cria se ainda não houver nenhum (usado pelo instalador)
#
# A senha nova é mostrada na tela e salva em /root/sistema-clinica-admin.txt.
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ARQ_CREDENCIAIS="/root/sistema-clinica-admin.txt"

[ -f "$ENV_FILE" ] || { echo "[erro] $ENV_FILE não encontrado em $(pwd)." >&2; exit 1; }
DOMINIO="$(grep -E '^DOMINIO=' "$ENV_FILE" | cut -d= -f2-)"

SO_SE_NAO_EXISTIR=0
ADMIN_EMAIL=""
for arg in "$@"; do
  case "$arg" in
    --se-nao-existir) SO_SE_NAO_EXISTIR=1 ;;
    *) ADMIN_EMAIL="$arg" ;;
  esac
done
ADMIN_SENHA="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

# Imprime uma única linha "RESULTADO:<acao>:<email>"; o resto da saída (avisos do Prisma etc.) é ignorado.
SAIDA="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T \
  -e ADMIN_EMAIL="$ADMIN_EMAIL" -e ADMIN_EMAIL_PADRAO="admin@$DOMINIO" -e ADMIN_SENHA="$ADMIN_SENHA" \
  -e SO_SE_NAO_EXISTIR="$SO_SE_NAO_EXISTIR" api node -e "
const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const total = await p.usuarioPlataforma.count();
  if (total && process.env.SO_SE_NAO_EXISTIR === '1') { console.log('RESULTADO:existente:'); return; }
  const senha_hash = await bcrypt.hash(process.env.ADMIN_SENHA, 10);
  const alvo = process.env.ADMIN_EMAIL
    ? await p.usuarioPlataforma.findUnique({ where: { email: process.env.ADMIN_EMAIL } })
    : await p.usuarioPlataforma.findFirst({ orderBy: { criado_em: 'asc' } });
  if (alvo) {
    await p.usuarioPlataforma.update({ where: { id: alvo.id }, data: { senha_hash, ativo: true } });
    console.log('RESULTADO:redefinido:' + alvo.email);
  } else {
    const email = process.env.ADMIN_EMAIL || process.env.ADMIN_EMAIL_PADRAO;
    await p.usuarioPlataforma.create({ data: { nome: 'Administrador', email, senha_hash } });
    console.log('RESULTADO:criado:' + email);
  }
})().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.\$disconnect());" 2>&1)" || {
  echo "[erro] falha ao criar/redefinir o super admin:" >&2
  echo "$SAIDA" >&2
  exit 1
}

LINHA="$(printf '%s\n' "$SAIDA" | grep -E '^RESULTADO:' | tail -n1 || true)"
ACAO="$(printf '%s' "$LINHA" | cut -d: -f2)"
EMAIL="$(printf '%s' "$LINHA" | cut -d: -f3-)"

case "$ACAO" in
  existente)
    echo "  Super admin:  já existia (senha não alterada). Para redefinir: ./deploy/redefinir-admin.sh"
    ;;
  criado|redefinido)
    umask 077
    printf 'URL: https://%s/admin/login\nE-mail: %s\nSenha: %s\n' "$DOMINIO" "$EMAIL" "$ADMIN_SENHA" > "$ARQ_CREDENCIAIS"
    echo "  Super admin:  $EMAIL / $ADMIN_SENHA  ($ACAO)"
    echo "                A senha também fica salva em $ARQ_CREDENCIAIS (apague o arquivo depois de anotar)."
    ;;
  *)
    echo "[erro] resposta inesperada ao criar/redefinir o super admin:" >&2
    echo "$SAIDA" >&2
    exit 1
    ;;
esac
