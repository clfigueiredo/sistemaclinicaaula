#!/usr/bin/env bash
# Acessos do sistema em produção: prepara o banco (recursos, planos, super admin e clínica) e mostra/salva
# o login dos dois painéis em ACESSOS.txt, na raiz do projeto (ao lado do CLAUDE.md).
#
# Uso (na VPS, como root):
#   ./deploy/acessos.sh               # cria o que faltar e mostra os acessos (o instalador chama este)
#   ./deploy/acessos.sh --redefinir   # gera senhas novas para o super admin e para o admin da clínica
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ARQ_ACESSOS="$(pwd)/ACESSOS.txt"

[ -f "$ENV_FILE" ] || { echo "[erro] $ENV_FILE não encontrado em $(pwd)." >&2; exit 1; }
valor_env() { grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2-; }
DOMINIO_SITE="$(valor_env DOMINIO_SITE)"; DOMINIO_APP="$(valor_env DOMINIO_APP)"; DOMINIO_ADMIN="$(valor_env DOMINIO_ADMIN)"
[ -n "$DOMINIO_SITE" ] && [ -n "$DOMINIO_APP" ] && [ -n "$DOMINIO_ADMIN" ]   || { echo "[erro] defina DOMINIO_SITE, DOMINIO_APP e DOMINIO_ADMIN no $ENV_FILE (rode o instalador)." >&2; exit 1; }
MODO=instalar
[ "${1:-}" = "--redefinir" ] && MODO=redefinir

SAIDA="$(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T -e DOMINIO="$DOMINIO_SITE" -e MODO="$MODO" \
  api node --input-type=commonjs - < deploy/inicializar-producao.cjs 2>&1)" || {
  echo "[erro] falha ao preparar os acessos:" >&2
  echo "$SAIDA" >&2
  exit 1
}

# Lê "ACESSO|tipo|email|senha|estado"; avisos do Prisma e afins são ignorados.
campo() { printf '%s\n' "$SAIDA" | grep -E "^ACESSO\|$1\|" | tail -n1 | cut -d'|' -f"$2"; }
ADMIN_EMAIL="$(campo admin 3)"; ADMIN_SENHA="$(campo admin 4)"; ADMIN_ESTADO="$(campo admin 5)"
CLIN_EMAIL="$(campo clinica 3)"; CLIN_SENHA="$(campo clinica 4)"; CLIN_ESTADO="$(campo clinica 5)"
if [ -z "$ADMIN_ESTADO" ] || [ -z "$CLIN_ESTADO" ]; then
  echo "[erro] resposta inesperada ao preparar os acessos:" >&2
  echo "$SAIDA" >&2
  exit 1
fi

# Senha que não mudou nesta execução: reaproveita a do ACESSOS.txt anterior, se houver.
senha_anterior() {
  [ -f "$ARQ_ACESSOS" ] || return 0
  awk -v sec="$1" '$0 == sec { f = 1; next } /^\[/ { f = 0 } f && /^Senha:/ { sub(/^Senha:[ ]*/, ""); print; exit }' "$ARQ_ACESSOS"
}
SEM_SENHA="(não alterada — rode ./deploy/acessos.sh --redefinir para gerar uma nova)"
[ -n "$ADMIN_SENHA" ] || ADMIN_SENHA="$(senha_anterior '[PAINEL SUPER ADMIN]')"
[ -n "$CLIN_SENHA" ] || CLIN_SENHA="$(senha_anterior '[PAINEL DA CLÍNICA]')"

umask 077
cat > "$ARQ_ACESSOS" <<EOF
SISTEMA CLÍNICA — ACESSOS ($(date '+%d/%m/%Y %H:%M'))
Guarde em local seguro e troque as senhas no primeiro acesso. Este arquivo não vai para o git.

[PAINEL SUPER ADMIN]
Para: dono do SaaS — planos, clínicas, cobrança.
URL: https://$DOMINIO_ADMIN/admin/login
E-mail: $ADMIN_EMAIL
Senha: ${ADMIN_SENHA:-$SEM_SENHA}

[PAINEL DA CLÍNICA]
Para: a clínica "Minha Clínica" (plano Profissional, ativa) — agenda, pacientes, prontuário, financeiro.
URL: https://$DOMINIO_APP/login
E-mail: $CLIN_EMAIL
Senha: ${CLIN_SENHA:-$SEM_SENHA}

[OUTROS ENDEREÇOS]
Landing page:                              https://$DOMINIO_SITE
Cadastro de novas clínicas (teste grátis): https://$DOMINIO_APP/cadastro
EOF
chmod 600 "$ARQ_ACESSOS"
umask 022

echo
echo "================================================================"
echo "  ACESSOS DO SISTEMA"
echo "================================================================"
echo "  PAINEL SUPER ADMIN  https://$DOMINIO_ADMIN/admin/login"
echo "    E-mail: $ADMIN_EMAIL"
echo "    Senha:  ${ADMIN_SENHA:-$SEM_SENHA}"
echo
echo "  PAINEL DA CLÍNICA   https://$DOMINIO_APP/login"
echo "    E-mail: $CLIN_EMAIL"
echo "    Senha:  ${CLIN_SENHA:-$SEM_SENHA}"
echo
echo "  LANDING PAGE        https://$DOMINIO_SITE"
echo "================================================================"
echo "  Salvo em: $ARQ_ACESSOS"
echo "================================================================"
