# Deploy em produção (VPS)

Stack de produção: `docker-compose.prod.yml` = Postgres + Redis + WPPConnect (sem portas expostas) +
API + worker (imagem `deploy/Dockerfile.api`) + Caddy servindo o build do web e fazendo proxy de
`/api` → `api:3333` com HTTPS automático (`deploy/Dockerfile.web` + `deploy/Caddyfile`).

> O `docker-compose.yml` da raiz é **só para desenvolvimento** (portas em `127.0.0.1`, WPPConnect com
> chaves de exemplo). Não use na VPS.

## 1. Preparar a VPS

1. Ubuntu/Debian atualizado, Docker Engine + plugin `docker compose` instalados.
2. DNS: registro `A` (e `AAAA`, se houver IPv6) do domínio apontando para a VPS.
3. Firewall: libere **somente** 22 (SSH), 80 e 443 (ex.: `ufw allow OpenSSH && ufw allow 80,443/tcp && ufw allow 443/udp && ufw enable`).
   Atenção: portas publicadas pelo Docker ignoram o `ufw` — por isso o compose de produção não publica
   Postgres, Redis nem WPPConnect.
4. Copie o projeto para `/opt/sistema-clinica` (git clone).

## 2. Segredos (`.env.prod`, fora do git)

Gere cada segredo com `openssl rand -hex 32` (só `[0-9a-f]`, seguro dentro de URLs):

```bash
cd /opt/sistema-clinica
cat > .env.prod <<EOF
DOMINIO=clinica.seudominio.com.br
EMAIL_ACME=voce@seudominio.com.br
POSTGRES_USER=clinica
POSTGRES_DB=clinica
POSTGRES_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)
WPPCONNECT_SECRET_KEY=$(openssl rand -hex 32)
WEBHOOK_TOKEN=$(openssl rand -hex 32)
EOF
chmod 600 .env.prod
```

Todas as variáveis acima são obrigatórias (`${VAR:?}` no compose). Com `NODE_ENV=production` a API
**se recusa a subir** se `JWT_SECRET`, `WEBHOOK_TOKEN` ou `WPPCONNECT_SECRET_KEY` tiverem menos de 32
caracteres ou contiverem `troque`/`exemplo`/`changeme`, ou se a `REDIS_URL` não tiver senha.
O compose já define `TRUST_PROXY=1` (a API confia só no `X-Forwarded-For` do Caddy) e
`EXECUTAR_WORKERS=false` (workers no container `worker`).

## 3. Subir

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps        # tudo "running"/"healthy"
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api
```

A API aplica as migrations (`prisma migrate deploy`) ao iniciar. **Não rode o seed de desenvolvimento**
em produção (ele cria usuários com senhas conhecidas); crie o super admin e os planos manualmente.
Atualizar: `git pull` e repetir o `up -d --build`.

## 4. Backup diário

`deploy/backup.sh` gera `banco-<data>.dump` (`pg_dump -Fc`) e `anexos-<data>.tar.gz` em
`/var/backups/sistema-clinica` e apaga os com mais de 7 dias (`RETENCAO_DIAS`).

```bash
chmod +x deploy/backup.sh
crontab -e
# todo dia às 03:15
15 3 * * * cd /opt/sistema-clinica && ./deploy/backup.sh >> /var/log/clinica-backup.log 2>&1
```

Copie os backups para fora da VPS (ex.: `rclone`/`rsync` para um storage externo) — backup só na
mesma máquina não protege contra perda do servidor.

Restaurar o banco:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < /var/backups/sistema-clinica/banco-AAAA-MM-DD_HHMM.dump
```
