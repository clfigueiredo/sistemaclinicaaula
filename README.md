# Sistema Clínica

SaaS multi-tenant de gestão para clínicas particulares: agenda, pacientes, prontuário eletrônico com anexos,
lembretes e confirmação pelo WhatsApp, financeiro (caixa, contas a pagar/receber, recorrências, repasses),
agendamento online com aprovação da recepção, lista de espera, retornos, receituário/atestado em PDF e
dashboard. O dono do SaaS gerencia planos, clínicas e a cobrança automática (Asaas, Stripe ou Mercado Pago)
num painel super admin. Cada clínica é totalmente isolada (`clinica_id`).

**Stack:** React 19 + Vite + Tailwind/shadcn (web) · Node + Fastify + Zod (API) · PostgreSQL + Prisma ·
Redis + BullMQ · WPPConnect (WhatsApp) · Docker / Caddy.

**Status:** MVP e Fase 2 concluídos. Pendentes: teste do WhatsApp com celular real, gateways em sandbox com
credenciais reais e o primeiro deploy na VPS.

## Como subir (Windows, desenvolvimento)

Pré-requisitos: Node 20.19+, Docker Desktop.

```powershell
copy .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
npm run dev          # API http://localhost:3333 · Web http://localhost:5173
```

No dia a dia, basta dar duplo clique em **`iniciar-sistema.bat`** (log em `logs\dev.log`).

Logins do seed: super admin `admin@sistema.local` / `admin123` (`/admin/login`); Clínica Demo
`admin@demo.local`, `recepcao@demo.local`, `profissional@demo.local` / `demo123`.

## Deploy na VPS (produção) — passo a passo

O instalador `deploy/instalar-vps.sh` faz tudo sozinho e **só pergunta o domínio**: todas as senhas e chaves
são geradas aleatoriamente e gravadas no `.env.prod` da VPS.

### O que você precisa

- Uma **VPS com Ubuntu 22.04/24.04 ou Debian 12**, acesso **root** por SSH e no mínimo **2 GB de RAM**
  (recomendado 4 GB — o build das imagens consome memória).
- Um **domínio ou subdomínio** (ex.: `clinica.seudominio.com.br`).

### 1. Apontar o domínio para a VPS

No painel DNS do seu domínio (Registro.br, Cloudflare, Hostinger etc.), crie um registro:

| Tipo | Nome | Valor |
|---|---|---|
| `A` | `clinica` (ou `@` para o domínio raiz) | IP da sua VPS |

> Na Cloudflare, deixe a nuvem **cinza** (“DNS only”) — o próprio sistema emite o certificado HTTPS.
> Aguarde alguns minutos para o DNS propagar (teste com `ping clinica.seudominio.com.br`).

### 2. Entrar na VPS

```bash
ssh root@IP_DA_VPS
```

### 3. Rodar o instalador

```bash
curl -fsSL https://raw.githubusercontent.com/clfigueiredo/sistemaclinicaaula/main/deploy/instalar-vps.sh | bash
```

Digite o domínio quando ele pedir e aguarde (5 a 15 minutos na primeira vez). O script:

1. instala o Docker e baixa o projeto em `/opt/sistema-clinica`;
2. gera o `.env.prod` com senhas e chaves aleatórias;
3. libera as portas 22, 80 e 443 no firewall;
4. sobe banco, Redis, WhatsApp, API, worker e o Caddy (HTTPS automático com Let's Encrypt);
5. cria o **super admin** com senha aleatória;
6. agenda o backup diário (03:15, em `/var/backups/sistema-clinica`).

No final aparece um resumo como este — **anote a senha**:

```
==> Instalação concluída!
  Sistema:      https://clinica.seudominio.com.br
  Painel admin: https://clinica.seudominio.com.br/admin/login
  Super admin:  admin@clinica.seudominio.com.br / Xk3...
```

A senha também fica salva em `/root/sistema-clinica-admin.txt` (apague o arquivo depois de anotar).
Perdeu a senha ou ela não apareceu? Gere uma nova com:

```bash
cd /opt/sistema-clinica && ./deploy/redefinir-admin.sh
```

### 4. Primeira configuração no painel

1. Acesse `https://SEU_DOMINIO/admin/login` com o super admin.
2. Em **Planos**, crie um plano de teste grátis e marque-o como **plano de cadastro** — sem isso o
   cadastro de clínicas em `https://SEU_DOMINIO/cadastro` não funciona.
3. (Opcional) Em **Cobrança**, configure o gateway de pagamento (Asaas, Stripe ou Mercado Pago).
4. Cadastre uma clínica em `/cadastro` e conecte o WhatsApp dela pelo QR code (menu **WhatsApp**).

### Comandos úteis (na VPS)

```bash
cd /opt/sistema-clinica
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'

dc ps                      # status dos containers
dc logs -f api worker      # logs da API e dos jobs
dc logs caddy              # logs do HTTPS/certificado
dc restart api worker      # reiniciar
./deploy/backup.sh         # backup manual agora
./deploy/redefinir-admin.sh  # nova senha aleatória para o super admin
```

**Atualizar para a versão mais nova:** rode o mesmo comando do passo 3 (ou `sudo ./deploy/instalar-vps.sh`
dentro de `/opt/sistema-clinica`). Ele baixa o código novo, **mantém as senhas e chaves** e reconstrói os containers.

### Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| Aviso “domínio não resolve” / site sem HTTPS | DNS ainda não aponta para a VPS. Corrija o registro `A`, espere propagar e rode `dc restart caddy`. |
| Build parou com erro de memória (`Killed`) | VPS com pouca RAM. Use uma de 4 GB ou crie swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
| “a API não respondeu em 5 minutos” | Veja `dc logs api` (geralmente migration ou banco ainda subindo) e rode o instalador de novo. |
| Senha do super admin não apareceu / esqueci | `cd /opt/sistema-clinica && ./deploy/redefinir-admin.sh` gera uma senha nova e mostra na tela. |
| `/cadastro` dá erro | Falta marcar um plano como **plano de cadastro** no painel admin. |

> **Importante:** guarde uma cópia do `/opt/sistema-clinica/.env.prod` fora da VPS. A `CHAVE_CRIPTOGRAFIA`
> dele é necessária para ler as credenciais dos gateways num backup restaurado — nunca a troque depois de em uso.

Detalhes técnicos, instalação manual, webhooks e restauração de backup: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — guia do projeto: regras, convenções, comandos, decisões de negócio e status
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — arquitetura, planos e recursos, papéis, modelo de dados e fluxos
- [`docs/FASE2.md`](docs/FASE2.md) — contratos dos módulos da fase 2
- [`docs/SETUP_LOCAL.md`](docs/SETUP_LOCAL.md) — setup local, roteiros de teste manual e solução de problemas
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy em produção na VPS e backup
