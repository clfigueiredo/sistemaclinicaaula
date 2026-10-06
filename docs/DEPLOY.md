# Deploy em produção (VPS)

> Status: o compose de produção está pronto, mas o **primeiro deploy numa VPS ainda não foi feito** (as imagens
> não foram construídas fora da máquina de desenvolvimento). Siga este roteiro e registre aqui o que divergir.

Stack de produção (`docker-compose.prod.yml`, arquivo completo — não é override do de dev):

| Serviço | Imagem / build | Função |
|---|---|---|
| `postgres` | `postgres:16-alpine` | banco (volume `postgres_dados`), sem porta publicada |
| `redis` | `redis:7-alpine` com `--requirepass` | filas BullMQ (volume `redis_dados`), sem porta publicada |
| `wppconnect` | `wppconnect/server-cli` | WhatsApp; webhook interno `http://api:3333/webhooks/whatsapp?token=...` (não passa pelo Caddy) |
| `api` | `deploy/Dockerfile.api` | aplica `prisma migrate deploy` e sobe a API (`EXECUTAR_WORKERS=false`); volume `uploads` |
| `worker` | mesma imagem da API | `node dist/worker.js` — todos os jobs BullMQ (envio WhatsApp, lembretes 09:00, recorrências 06:00, cobranças 07:00, retornos 09:30, expiração de solicitações de hora em hora) |
| `caddy` | `deploy/Dockerfile.web` | build do web + `deploy/Caddyfile`: HTTPS automático (Let's Encrypt), proxy `/api/*` → `api:3333` (remove o `/api`), fallback SPA, cabeçalhos de segurança |

Só o Caddy publica portas (80/443 e 443/udp). O `docker-compose.yml` da raiz é **só para desenvolvimento**
(portas em `127.0.0.1`, WPPConnect com chaves de exemplo) — não use na VPS.

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
CHAVE_CRIPTOGRAFIA=$(openssl rand -hex 32)
EOF
chmod 600 .env.prod
```

Todas as variáveis acima são obrigatórias (`${VAR:?}` no compose). Opcionais (com padrão): `LOG_LEVEL` (info),
`JWT_EXPIRA_EM` (12h), `UPLOAD_MAX_MB` (10), `TZ_PADRAO` (America/Sao_Paulo).

Com `NODE_ENV=production` a API **se recusa a subir** (`config/env.ts`, `problemasDeSeguranca`) se
`JWT_SECRET`, `WEBHOOK_TOKEN` ou `WPPCONNECT_SECRET_KEY` tiverem menos de 32 caracteres ou contiverem
`troque`/`exemplo`/`changeme`, se a `REDIS_URL` não tiver senha, ou se a `CHAVE_CRIPTOGRAFIA` não tiver 64
caracteres hexadecimais (ou for a chave de desenvolvimento).

> **`CHAVE_CRIPTOGRAFIA`** cifra (AES-256-GCM) as credenciais e segredos de webhook dos gateways de pagamento.
> **Não troque depois de em uso** — os segredos já gravados ficariam ilegíveis (seria preciso recadastrá-los).
> Guarde uma cópia do `.env.prod` em local seguro, fora da VPS.

O compose define sozinho (a partir de `DOMINIO`):

| Variável | Valor | Uso |
|---|---|---|
| `WEB_URL` | `https://DOMINIO` | CORS |
| `WEB_URL_PUBLICA` | `https://DOMINIO` | links enviados ao paciente (ex.: `/agendar/<slug>`) |
| `API_URL_PUBLICA` | `https://DOMINIO/api` | URLs de webhook dos gateways |
| `TRUST_PROXY` | `1` | a API confia só no `X-Forwarded-For` do Caddy |
| `EXECUTAR_WORKERS` | `false` | workers rodam no container `worker` |
| `HOST` / `PORT` | `0.0.0.0` / `3333` | |

## 3. Subir

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.prod ps        # tudo "running"/"healthy"
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f api worker
curl https://DOMINIO/api/saude                                            # {"status":"ok",...}
```

A API aplica as migrations (`prisma migrate deploy`) ao iniciar. Atualizar: `git pull` e repetir o
`up -d --build`.

### 3.1 Primeiro acesso (sem o seed)

**Não rode o seed de desenvolvimento** em produção (ele cria usuários com senhas conhecidas). Crie o super admin
direto no container da API (troque e-mail e senha):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec api node -e "
const { PrismaClient } = require('@prisma/client'); const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  await p.usuarioPlataforma.create({ data: { nome: 'Administrador', email: process.argv[1], senha_hash: await bcrypt.hash(process.argv[2], 10) } });
  console.log('super admin criado'); await p.\$disconnect();
})();" voce@seudominio.com.br 'UMA-SENHA-FORTE'
```

Depois, em `https://DOMINIO/admin/login`:

1. **Planos**: crie o plano de teste grátis (ex.: limites 1/1/1/1, WhatsApp, 3 mensagens, período total, recursos
   da fase 2 ligados) e **marque-o como plano de cadastro** — sem isso o auto-cadastro (`/cadastro`) falha. Crie
   os planos pagos (planos novos nascem com os recursos da fase 2 desligados: ligue os que fizerem parte do plano).
2. **Cobrança** (se for cobrar pelo sistema): configure o gateway (ver §4) e ative-o.

## 4. Webhooks

| Origem | URL | Observação |
|---|---|---|
| WPPConnect → API | `http://api:3333/webhooks/whatsapp?token=WEBHOOK_TOKEN` | já configurado no compose (rede interna) |
| Asaas | `https://DOMINIO/api/webhooks/pagamentos/asaas` | token de autenticação = segredo do webhook cadastrado no painel `/admin/cobranca` |
| Stripe | `https://DOMINIO/api/webhooks/pagamentos/stripe` | segredo `whsec_...` do endpoint; chave `sk_live_` no ambiente produção |
| Mercado Pago | `https://DOMINIO/api/webhooks/pagamentos/mercado_pago` | assinatura secreta do webhook |

A URL exata de cada gateway aparece no card do gateway em `/admin/cobranca`. Use credenciais de **produção** e
ambiente **produção** só depois de validar o fluxo em sandbox (`docs/SETUP_LOCAL.md` §4.4); pagamentos de
cobranças geradas em sandbox são ignorados quando o gateway já está em produção.

O WhatsApp de cada clínica é conectado pela própria clínica (menu WhatsApp → QR code); as sessões ficam nos
volumes `wpp_tokens`/`wpp_userdata`.

## 5. Backup diário

`deploy/backup.sh` gera `banco-<data>.dump` (`pg_dump -Fc`) e `anexos-<data>.tar.gz` (volume `uploads`) em
`/var/backups/sistema-clinica` e apaga os com mais de 7 dias. Variáveis opcionais: `BACKUP_DIR`,
`RETENCAO_DIAS`, `ENV_FILE`, `COMPOSE_FILE`.

```bash
chmod +x deploy/backup.sh
crontab -e
# todo dia às 03:15
15 3 * * * cd /opt/sistema-clinica && ./deploy/backup.sh >> /var/log/clinica-backup.log 2>&1
```

Copie os backups para fora da VPS (ex.: `rclone`/`rsync` para um storage externo) — backup só na
mesma máquina não protege contra perda do servidor. Guarde junto (em local seguro) o `.env.prod`: sem a
`CHAVE_CRIPTOGRAFIA` as credenciais dos gateways no backup não podem ser lidas.

Restaurar o banco:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < /var/backups/sistema-clinica/banco-AAAA-MM-DD_HHMM.dump
```

Restaurar os anexos:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T api \
  tar xzf - -C /app/apps/api < /var/backups/sistema-clinica/anexos-AAAA-MM-DD_HHMM.tar.gz
```

## 6. Checklist pós-deploy

- [ ] `https://DOMINIO` abre com certificado válido; `https://DOMINIO/api/saude` responde `ok`.
- [ ] Super admin entra em `/admin/login`; existe um plano marcado como plano de cadastro.
- [ ] Auto-cadastro em `/cadastro` cria clínica em teste grátis.
- [ ] WhatsApp de uma clínica de teste conecta pelo QR e o lembrete/resposta funciona (webhook interno).
- [ ] Gateway em produção: cobrança de valor baixo paga e confirmada pelo webhook.
- [ ] `docker compose ... logs worker` mostra os workers iniciados; cron do backup gerando arquivos.
