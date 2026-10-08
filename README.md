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

O instalador `deploy/instalar-vps.sh` faz tudo sozinho e **só pergunta os domínios**: todas as senhas e chaves
são geradas aleatoriamente e gravadas no `.env.prod` da VPS.

O sistema usa **três endereços**, um para cada área:

| Área | Exemplo | O que tem |
|---|---|---|
| Landing page | `seudominio.com.br` | página de apresentação (uma de teste já vem pronta, troque pela sua) |
| Painel da clínica | `app.seudominio.com.br` | login, cadastro de clínicas, agenda, prontuário, agendamento online |
| Painel do administrador | `admin.seudominio.com.br` | planos, clínicas e cobrança (super admin) |

### O que você precisa

- Uma **VPS com Ubuntu 22.04/24.04 ou Debian 12**, acesso **root** por SSH e no mínimo **2 GB de RAM**
  (recomendado 4 GB — o build das imagens consome memória).
- Um **domínio** (ex.: `seudominio.com.br`).

### 1. Apontar os domínios para a VPS

No painel DNS do seu domínio (Registro.br, Cloudflare, Hostinger etc.), crie **três** registros:

| Tipo | Nome | Valor |
|---|---|---|
| `A` | `@` (domínio raiz — landing page) | IP da sua VPS |
| `A` | `app` (painel da clínica) | IP da sua VPS |
| `A` | `admin` (painel do administrador) | IP da sua VPS |

> Na Cloudflare, deixe a nuvem **cinza** (“DNS only”) — o próprio sistema emite os certificados HTTPS.
> Aguarde alguns minutos para o DNS propagar (teste com `ping app.seudominio.com.br`).
> Pode usar outros nomes (ex.: landing em `www.`, painel em `sistema.`): o instalador pergunta cada um.

### 2. Entrar na VPS

```bash
ssh root@IP_DA_VPS
```

### 3. Rodar o instalador

```bash
curl -fsSL https://raw.githubusercontent.com/clfigueiredo/sistemaclinicaaula/main/deploy/instalar-vps.sh | bash
```

Ele pergunta os três domínios — para o painel da clínica e o do administrador já sugere `app.` e `admin.` do
domínio da landing (basta apertar Enter). Depois é só aguardar (5 a 15 minutos na primeira vez). O script:

1. instala o Docker e baixa o projeto em `/opt/sistema-clinica`;
2. gera o `.env.prod` com senhas e chaves aleatórias;
3. libera as portas 22, 80 e 443 no firewall;
4. sobe banco, Redis, WhatsApp, API, worker e o Caddy (HTTPS automático com Let's Encrypt);
5. prepara o banco: catálogo de recursos, planos **Teste grátis** (já marcado como plano de cadastro) e
   **Profissional**, o **super admin** e a clínica **Minha Clínica** com um usuário admin;
6. agenda o backup diário (03:15, em `/var/backups/sistema-clinica`).

No final aparece o quadro com os **acessos dos dois painéis** (senhas aleatórias):

```
================================================================
  ACESSOS DO SISTEMA
================================================================
  PAINEL SUPER ADMIN  https://admin.seudominio.com.br/admin/login
    E-mail: admin@seudominio.com.br
    Senha:  Xk3...

  PAINEL DA CLÍNICA   https://app.seudominio.com.br/login
    E-mail: clinica@seudominio.com.br
    Senha:  Pq9...

  LANDING PAGE        https://seudominio.com.br
================================================================
  Salvo em: /opt/sistema-clinica/ACESSOS.txt
================================================================
```

Os acessos ficam salvos em **`/opt/sistema-clinica/ACESSOS.txt`** (raiz do projeto, ao lado do `CLAUDE.md`;
o arquivo não vai para o git). Para ver de novo ou gerar senhas novas:

```bash
cat /opt/sistema-clinica/ACESSOS.txt                        # ver os acessos
cd /opt/sistema-clinica && ./deploy/acessos.sh --redefinir  # senhas novas para os dois painéis
```

### 4. Pronto para usar

O sistema já sai configurado — não precisa criar plano nem clínica na mão.

- **Landing page** (`seudominio.com.br`): página de teste com botões para o cadastro e o login do painel da
  clínica. Para trocar pela sua, edite os arquivos em `/opt/sistema-clinica/landing/` (vale na hora, sem rebuild).
  No HTML, `{{env "DOMINIO_APP"}}` vira o domínio do painel da clínica — use nos links de cadastro/login.
- **Painel super admin** (`admin.seudominio.com.br`): planos, clínicas, cobrança. Os planos “Teste grátis” e “Profissional”
  podem ser editados à vontade.
- **Painel da clínica** (`app.seudominio.com.br`): a “Minha Clínica” já está no plano Profissional, ativa. Troque o nome e os
  dados em **Configurações**, cadastre profissionais e conecte o WhatsApp pelo QR code (menu **WhatsApp**).
- **Novas clínicas** se cadastram sozinhas em `app.seudominio.com.br/cadastro` (entram no Teste grátis).
- (Opcional) Em **Cobrança** no super admin, configure o gateway de pagamento (Asaas, Stripe ou Mercado Pago).

### Comandos úteis (na VPS)

```bash
cd /opt/sistema-clinica
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'

dc ps                      # status dos containers
dc logs -f api worker      # logs da API e dos jobs
dc logs caddy              # logs do HTTPS/certificado
dc restart api worker      # reiniciar
./deploy/backup.sh         # backup manual agora
./deploy/acessos.sh --redefinir  # senhas novas para os dois painéis
```

**Trocar algum domínio** ou **atualizar para a versão mais nova:** rode o mesmo comando do passo 3 (ou `sudo ./deploy/instalar-vps.sh`
dentro de `/opt/sistema-clinica`). Ele baixa o código novo, **mantém as senhas e chaves** e reconstrói os containers.

### Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| Aviso “domínio não resolve” / site sem HTTPS | O DNS daquele domínio ainda não aponta para a VPS. Corrija o registro `A`, espere propagar e rode `dc restart caddy`. |
| Abri `/admin` no domínio da clínica e fui redirecionado | Normal: o painel do administrador só funciona no domínio dele. |
| Build parou com erro de memória (`Killed`) | VPS com pouca RAM. Use uma de 4 GB ou crie swap: `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`. |
| “a API não respondeu em 5 minutos” | Veja `dc logs api` (geralmente migration ou banco ainda subindo) e rode o instalador de novo. |
| Esqueci / perdi as senhas | `cat /opt/sistema-clinica/ACESSOS.txt` ou `./deploy/acessos.sh --redefinir` (gera novas e mostra na tela). |
| `/cadastro` dá erro | Nenhum plano ativo marcado como **plano de cadastro** — marque um no painel super admin. |

> **Importante:** guarde uma cópia do `/opt/sistema-clinica/.env.prod` fora da VPS. A `CHAVE_CRIPTOGRAFIA`
> dele é necessária para ler as credenciais dos gateways num backup restaurado — nunca a troque depois de em uso.

Detalhes técnicos, instalação manual, webhooks e restauração de backup: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Documentação

- [`CLAUDE.md`](CLAUDE.md) — guia do projeto: regras, convenções, comandos, decisões de negócio e status
- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — arquitetura, planos e recursos, papéis, modelo de dados e fluxos
- [`docs/FASE2.md`](docs/FASE2.md) — contratos dos módulos da fase 2
- [`docs/SETUP_LOCAL.md`](docs/SETUP_LOCAL.md) — setup local, roteiros de teste manual e solução de problemas
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — deploy em produção na VPS e backup
