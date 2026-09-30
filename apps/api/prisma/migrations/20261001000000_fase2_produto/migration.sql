-- Fase 2 do produto: financeiro, agendamento online, lista de espera, documentos PDF, retornos,
-- dashboard e cobrança automática do SaaS. Contratos em docs/FASE2.md.
-- Parte 1 gerada pelo Prisma (migrate diff); parte 2 (no fim) é SQL manual.

-- CreateEnum
CREATE TYPE "forma_pagamento" AS ENUM ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'convenio', 'outro');

-- CreateEnum
CREATE TYPE "tipo_conta_financeira" AS ENUM ('caixa', 'banco', 'carteira_digital', 'outro');

-- CreateEnum
CREATE TYPE "tipo_categoria_financeira" AS ENUM ('receita', 'despesa');

-- CreateEnum
CREATE TYPE "tipo_movimentacao" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "origem_movimentacao" AS ENUM ('manual', 'consulta', 'titulo', 'repasse', 'estorno');

-- CreateEnum
CREATE TYPE "tipo_titulo" AS ENUM ('pagar', 'receber');

-- CreateEnum
CREATE TYPE "status_titulo" AS ENUM ('aberto', 'pago', 'cancelado');

-- CreateEnum
CREATE TYPE "frequencia_recorrencia" AS ENUM ('mensal');

-- CreateEnum
CREATE TYPE "status_solicitacao_agendamento" AS ENUM ('pendente', 'aprovada', 'recusada', 'expirada');

-- CreateEnum
CREATE TYPE "status_lista_espera" AS ENUM ('aguardando', 'agendado', 'removido');

-- CreateEnum
CREATE TYPE "turno" AS ENUM ('manha', 'tarde', 'noite');

-- CreateEnum
CREATE TYPE "tipo_documento_clinico" AS ENUM ('receita', 'atestado', 'declaracao', 'pedido_exame');

-- CreateEnum
CREATE TYPE "status_retorno" AS ENUM ('pendente', 'agendado', 'lembrado', 'cancelado');

-- CreateEnum
CREATE TYPE "provedor_pagamento" AS ENUM ('asaas', 'stripe', 'mercado_pago');

-- CreateEnum
CREATE TYPE "ambiente_gateway" AS ENUM ('sandbox', 'producao');

-- CreateEnum
CREATE TYPE "metodo_cobranca" AS ENUM ('pix', 'boleto', 'cartao');

-- CreateEnum
CREATE TYPE "status_cobranca" AS ENUM ('pendente', 'paga', 'vencida', 'cancelada', 'estornada');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "tipo_mensagem" ADD VALUE 'agendamento_confirmado';
ALTER TYPE "tipo_mensagem" ADD VALUE 'agendamento_recusado';
ALTER TYPE "tipo_mensagem" ADD VALUE 'oferta_horario';
ALTER TYPE "tipo_mensagem" ADD VALUE 'convite_retorno';

-- AlterTable
ALTER TABLE "assinaturas" ADD COLUMN     "assinatura_externa_id" TEXT,
ADD COLUMN     "cliente_externo_id" TEXT,
ADD COLUMN     "dia_vencimento" SMALLINT,
ADD COLUMN     "gateway" "provedor_pagamento";

-- AlterTable
ALTER TABLE "clinicas" ADD COLUMN     "slug" TEXT;

-- AlterTable
ALTER TABLE "mensagens_whatsapp" ADD COLUMN     "consentimento_externo" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "profissionais" ADD COLUMN     "agendamento_online" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "percentual_repasse" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "gateways_pagamento" (
    "id" UUID NOT NULL,
    "provedor" "provedor_pagamento" NOT NULL,
    "ambiente" "ambiente_gateway" NOT NULL DEFAULT 'sandbox',
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "credenciais_cifradas" TEXT,
    "credenciais_final" VARCHAR(4),
    "segredo_webhook_cifrado" TEXT,
    "segredo_webhook_final" VARCHAR(4),
    "dias_tolerancia" INTEGER NOT NULL DEFAULT 5,
    "metodos" "metodo_cobranca"[] DEFAULT ARRAY['pix', 'boleto']::"metodo_cobranca"[],
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateways_pagamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobrancas" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "assinatura_id" UUID,
    "gateway" "provedor_pagamento" NOT NULL,
    "id_externo" TEXT,
    "descricao" TEXT,
    "valor" DECIMAL(10,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "status_cobranca" NOT NULL DEFAULT 'pendente',
    "metodo" "metodo_cobranca",
    "link_pagamento" TEXT,
    "pago_em" TIMESTAMP(3),
    "payload" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobrancas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eventos_gateway" (
    "id" UUID NOT NULL,
    "gateway" "provedor_pagamento" NOT NULL,
    "id_evento" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processado_em" TIMESTAMP(3),
    "erro" TEXT,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_gateway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracoes_clinica" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "ao_ativo" BOOLEAN NOT NULL DEFAULT false,
    "ao_antecedencia_min_horas" INTEGER NOT NULL DEFAULT 2,
    "ao_dias_a_frente" INTEGER NOT NULL DEFAULT 30,
    "ao_mensagem_boas_vindas" TEXT,
    "ao_max_pendentes_por_telefone" INTEGER NOT NULL DEFAULT 2,
    "retorno_convite_ativo" BOOLEAN NOT NULL DEFAULT true,
    "retorno_dias_antecedencia" INTEGER NOT NULL DEFAULT 7,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracoes_clinica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contas_financeiras" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "nome" TEXT NOT NULL,
    "tipo" "tipo_conta_financeira" NOT NULL DEFAULT 'caixa',
    "saldo_inicial" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contas_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categorias_financeiras" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "nome" TEXT NOT NULL,
    "tipo" "tipo_categoria_financeira" NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categorias_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentacoes_financeiras" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "tipo" "tipo_movimentacao" NOT NULL,
    "origem" "origem_movimentacao" NOT NULL DEFAULT 'manual',
    "data" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "conta_financeira_id" UUID NOT NULL,
    "categoria_id" UUID,
    "forma_pagamento" "forma_pagamento" NOT NULL,
    "descricao" TEXT,
    "agendamento_id" UUID,
    "paciente_id" UUID,
    "profissional_id" UUID,
    "titulo_id" UUID,
    "estorno_de_id" UUID,
    "repasse_inicio" DATE,
    "repasse_fim" DATE,
    "criado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentacoes_financeiras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "titulos" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "tipo" "tipo_titulo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "vencimento" DATE NOT NULL,
    "status" "status_titulo" NOT NULL DEFAULT 'aberto',
    "categoria_id" UUID,
    "paciente_id" UUID,
    "profissional_id" UUID,
    "fornecedor" TEXT,
    "forma_pagamento" "forma_pagamento",
    "parcela_numero" SMALLINT,
    "parcela_total" SMALLINT,
    "grupo_parcelas_id" UUID,
    "recorrencia_id" UUID,
    "competencia" DATE,
    "observacoes" TEXT,
    "pago_em" TIMESTAMP(3),
    "valor_pago" DECIMAL(12,2),
    "cancelado_em" TIMESTAMP(3),
    "criado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "titulos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recorrencias" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "tipo" "tipo_titulo" NOT NULL,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "dia_vencimento" SMALLINT NOT NULL,
    "frequencia" "frequencia_recorrencia" NOT NULL DEFAULT 'mensal',
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "categoria_id" UUID,
    "paciente_id" UUID,
    "profissional_id" UUID,
    "fornecedor" TEXT,
    "forma_pagamento" "forma_pagamento",
    "ultima_competencia" DATE,
    "criado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recorrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_agendamento" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "profissional_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "status" "status_solicitacao_agendamento" NOT NULL DEFAULT 'pendente',
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "email" TEXT,
    "cpf" TEXT,
    "nascimento" DATE,
    "observacoes" TEXT,
    "aceita_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "paciente_id" UUID,
    "agendamento_id" UUID,
    "motivo_recusa" TEXT,
    "analisado_por" UUID,
    "analisado_em" TIMESTAMP(3),
    "ip" TEXT,
    "user_agent" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solicitacoes_agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lista_espera" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID,
    "dias_semana" SMALLINT[],
    "turnos" "turno"[],
    "observacao" TEXT,
    "status" "status_lista_espera" NOT NULL DEFAULT 'aguardando',
    "agendamento_id" UUID,
    "ultima_oferta_em" TIMESTAMP(3),
    "criado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lista_espera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_clinicos" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "tipo" "tipo_documento_clinico" NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "agendamento_id" UUID,
    "autor_id" UUID,
    "titulo" TEXT,
    "conteudo" TEXT NOT NULL,
    "metadados" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_clinicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retornos" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL DEFAULT (current_setting('app.clinica_id'::text))::uuid,
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "agendamento_origem_id" UUID NOT NULL,
    "data_prevista" DATE NOT NULL,
    "status" "status_retorno" NOT NULL DEFAULT 'pendente',
    "agendamento_retorno_id" UUID,
    "observacao" TEXT,
    "convite_enviado_em" TIMESTAMP(3),
    "criado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retornos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateways_pagamento_provedor_key" ON "gateways_pagamento"("provedor");

-- CreateIndex
CREATE INDEX "cobrancas_clinica_id_vencimento_idx" ON "cobrancas"("clinica_id", "vencimento");

-- CreateIndex
CREATE INDEX "cobrancas_status_vencimento_idx" ON "cobrancas"("status", "vencimento");

-- CreateIndex
CREATE UNIQUE INDEX "cobrancas_gateway_id_externo_key" ON "cobrancas"("gateway", "id_externo");

-- CreateIndex
CREATE INDEX "eventos_gateway_recebido_em_idx" ON "eventos_gateway"("recebido_em");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_gateway_gateway_id_evento_key" ON "eventos_gateway"("gateway", "id_evento");

-- CreateIndex
CREATE UNIQUE INDEX "configuracoes_clinica_clinica_id_key" ON "configuracoes_clinica"("clinica_id");

-- CreateIndex
CREATE INDEX "contas_financeiras_clinica_id_idx" ON "contas_financeiras"("clinica_id");

-- CreateIndex
CREATE UNIQUE INDEX "contas_financeiras_clinica_id_nome_key" ON "contas_financeiras"("clinica_id", "nome");

-- CreateIndex
CREATE INDEX "categorias_financeiras_clinica_id_idx" ON "categorias_financeiras"("clinica_id");

-- CreateIndex
CREATE UNIQUE INDEX "categorias_financeiras_clinica_id_tipo_nome_key" ON "categorias_financeiras"("clinica_id", "tipo", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "movimentacoes_financeiras_estorno_de_id_key" ON "movimentacoes_financeiras"("estorno_de_id");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_idx" ON "movimentacoes_financeiras"("clinica_id");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_data_idx" ON "movimentacoes_financeiras"("clinica_id", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_conta_financeira_id_da_idx" ON "movimentacoes_financeiras"("clinica_id", "conta_financeira_id", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_profissional_id_data_idx" ON "movimentacoes_financeiras"("clinica_id", "profissional_id", "data");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_agendamento_id_idx" ON "movimentacoes_financeiras"("clinica_id", "agendamento_id");

-- CreateIndex
CREATE INDEX "movimentacoes_financeiras_clinica_id_titulo_id_idx" ON "movimentacoes_financeiras"("clinica_id", "titulo_id");

-- CreateIndex
CREATE INDEX "titulos_clinica_id_idx" ON "titulos"("clinica_id");

-- CreateIndex
CREATE INDEX "titulos_clinica_id_tipo_status_vencimento_idx" ON "titulos"("clinica_id", "tipo", "status", "vencimento");

-- CreateIndex
CREATE INDEX "titulos_clinica_id_grupo_parcelas_id_idx" ON "titulos"("clinica_id", "grupo_parcelas_id");

-- CreateIndex
CREATE UNIQUE INDEX "titulos_recorrencia_id_competencia_key" ON "titulos"("recorrencia_id", "competencia");

-- CreateIndex
CREATE INDEX "recorrencias_clinica_id_idx" ON "recorrencias"("clinica_id");

-- CreateIndex
CREATE INDEX "recorrencias_clinica_id_ativo_idx" ON "recorrencias"("clinica_id", "ativo");

-- CreateIndex
CREATE UNIQUE INDEX "solicitacoes_agendamento_agendamento_id_key" ON "solicitacoes_agendamento"("agendamento_id");

-- CreateIndex
CREATE INDEX "solicitacoes_agendamento_clinica_id_idx" ON "solicitacoes_agendamento"("clinica_id");

-- CreateIndex
CREATE INDEX "solicitacoes_agendamento_clinica_id_status_criado_em_idx" ON "solicitacoes_agendamento"("clinica_id", "status", "criado_em");

-- CreateIndex
CREATE INDEX "solicitacoes_agendamento_clinica_id_telefone_status_idx" ON "solicitacoes_agendamento"("clinica_id", "telefone", "status");

-- CreateIndex
CREATE INDEX "lista_espera_clinica_id_idx" ON "lista_espera"("clinica_id");

-- CreateIndex
CREATE INDEX "lista_espera_clinica_id_status_criado_em_idx" ON "lista_espera"("clinica_id", "status", "criado_em");

-- CreateIndex
CREATE INDEX "lista_espera_clinica_id_paciente_id_idx" ON "lista_espera"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "documentos_clinicos_clinica_id_idx" ON "documentos_clinicos"("clinica_id");

-- CreateIndex
CREATE INDEX "documentos_clinicos_clinica_id_paciente_id_criado_em_idx" ON "documentos_clinicos"("clinica_id", "paciente_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "retornos_agendamento_origem_id_key" ON "retornos"("agendamento_origem_id");

-- CreateIndex
CREATE INDEX "retornos_clinica_id_idx" ON "retornos"("clinica_id");

-- CreateIndex
CREATE INDEX "retornos_clinica_id_status_data_prevista_idx" ON "retornos"("clinica_id", "status", "data_prevista");

-- CreateIndex
CREATE INDEX "retornos_clinica_id_paciente_id_idx" ON "retornos"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "assinaturas_gateway_assinatura_externa_id_idx" ON "assinaturas"("gateway", "assinatura_externa_id");

-- CreateIndex
CREATE UNIQUE INDEX "clinicas_slug_key" ON "clinicas"("slug");

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_assinatura_id_fkey" FOREIGN KEY ("assinatura_id") REFERENCES "assinaturas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracoes_clinica" ADD CONSTRAINT "configuracoes_clinica_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contas_financeiras" ADD CONSTRAINT "contas_financeiras_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias_financeiras" ADD CONSTRAINT "categorias_financeiras_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_conta_financeira_id_fkey" FOREIGN KEY ("conta_financeira_id") REFERENCES "contas_financeiras"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_titulo_id_fkey" FOREIGN KEY ("titulo_id") REFERENCES "titulos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_estorno_de_id_fkey" FOREIGN KEY ("estorno_de_id") REFERENCES "movimentacoes_financeiras"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_recorrencia_id_fkey" FOREIGN KEY ("recorrencia_id") REFERENCES "recorrencias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias_financeiras"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_agendamento" ADD CONSTRAINT "solicitacoes_agendamento_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_agendamento" ADD CONSTRAINT "solicitacoes_agendamento_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_agendamento" ADD CONSTRAINT "solicitacoes_agendamento_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_agendamento" ADD CONSTRAINT "solicitacoes_agendamento_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lista_espera" ADD CONSTRAINT "lista_espera_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_clinicos" ADD CONSTRAINT "documentos_clinicos_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos" ADD CONSTRAINT "retornos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos" ADD CONSTRAINT "retornos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos" ADD CONSTRAINT "retornos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos" ADD CONSTRAINT "retornos_agendamento_origem_id_fkey" FOREIGN KEY ("agendamento_origem_id") REFERENCES "agendamentos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retornos" ADD CONSTRAINT "retornos_agendamento_retorno_id_fkey" FOREIGN KEY ("agendamento_retorno_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- Parte 2 — SQL manual (Prisma não representa: índices parciais, triggers, CHECKs, dados)
-- ============================================================================

-- 1) Só um gateway de cobrança ativo por vez.
CREATE UNIQUE INDEX "gateways_pagamento_ativo_unico" ON "gateways_pagamento" ("ativo") WHERE "ativo" = true;

-- 2) Documentos clínicos (receita/atestado/...) imutáveis, como o prontuário: sem UPDATE; DELETE só com a
--    flag de sessão `SET LOCAL app.permitir_exclusao_prontuario = 'on'` (a mesma do prontuário — rotinas
--    administrativas, ex.: exclusão definitiva de uma clínica). Função própria para a mensagem citar a tabela.
CREATE OR REPLACE FUNCTION documento_clinico_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'documentos_clinicos é imutável: correção deve ser um novo documento';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.permitir_exclusao_prontuario', true), '') <> 'on' THEN
    RAISE EXCEPTION 'documentos_clinicos é imutável: exclusão não permitida';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER documentos_clinicos_imutavel
  BEFORE UPDATE OR DELETE ON "documentos_clinicos"
  FOR EACH ROW EXECUTE FUNCTION documento_clinico_imutavel();

-- 3) CHECKs (segunda barreira além do Zod).
ALTER TABLE "movimentacoes_financeiras" ADD CONSTRAINT "movimentacoes_financeiras_valor_positivo" CHECK ("valor" > 0);
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_valor_positivo" CHECK ("valor" > 0);
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_valor_positivo" CHECK ("valor" > 0);
ALTER TABLE "recorrencias" ADD CONSTRAINT "recorrencias_dia_vencimento" CHECK ("dia_vencimento" BETWEEN 1 AND 31);
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_percentual_repasse" CHECK ("percentual_repasse" IS NULL OR ("percentual_repasse" >= 0 AND "percentual_repasse" <= 100));
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_dia_vencimento" CHECK ("dia_vencimento" IS NULL OR "dia_vencimento" BETWEEN 1 AND 28);
ALTER TABLE "clinicas" ADD CONSTRAINT "clinicas_slug_formato" CHECK ("slug" IS NULL OR "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- 4) Slug das clínicas existentes (mesma regra de utils/slug.ts: sem acento, minúsculas, hífens; máx. 60;
--    repetidos ganham sufixo -2, -3...).
WITH base AS (
  SELECT
    id,
    criado_em,
    coalesce(
      nullif(
        left(
          trim(BOTH '-' FROM regexp_replace(
            translate(lower("nome"),
              'áàâãäåéèêëíìîïóòôõöúùûüçñý',
              'aaaaaaeeeeiiiiooooouuuucny'),
            '[^a-z0-9]+', '-', 'g')),
          60),
        ''),
      'clinica') AS slug_base
  FROM "clinicas"
  WHERE "slug" IS NULL
),
numerado AS (
  SELECT id, slug_base, row_number() OVER (PARTITION BY slug_base ORDER BY criado_em, id) AS n FROM base
)
UPDATE "clinicas" c
SET "slug" = trim(BOTH '-' FROM numerado.slug_base) || CASE WHEN numerado.n > 1 THEN '-' || numerado.n ELSE '' END
FROM numerado
WHERE c.id = numerado.id;

-- 5) Catálogo de recursos (espelha CATALOGO_RECURSOS em src/plugins/recursos.ts; o seed também faz upsert).
INSERT INTO "recursos" ("codigo", "nome", "descricao", "tipo", "ordem") VALUES
  ('financeiro', 'Financeiro', 'Caixa, contas a pagar e a receber, recorrências e repasses', 'booleano', 7),
  ('agendamento_online', 'Agendamento online', 'Página pública para o paciente solicitar horários', 'booleano', 8),
  ('lista_espera', 'Lista de espera', 'Pacientes aguardando vaga, com sugestão quando um horário é liberado', 'booleano', 9),
  ('documentos_pdf', 'Receituário e atestados', 'Receitas, atestados, declarações e pedidos de exame em PDF', 'booleano', 10),
  ('retorno_automatico', 'Retorno automático', 'Controle de retornos com convite pelo WhatsApp', 'booleano', 11),
  ('dashboard', 'Dashboard', 'Indicadores da agenda e do financeiro', 'booleano', 12)
ON CONFLICT ("codigo") DO UPDATE SET "nome" = EXCLUDED."nome", "descricao" = EXCLUDED."descricao",
  "tipo" = EXCLUDED."tipo", "ordem" = EXCLUDED."ordem";

-- 6) Todos os planos existentes ganham as linhas dos recursos novos, DESABILITADAS (o super admin libera).
--    (O seed habilita tudo nos planos "Teste grátis" e "Profissional".)
INSERT INTO "plano_recursos" ("id", "plano_id", "recurso_codigo", "habilitado", "limite", "periodo")
SELECT gen_random_uuid(), p."id", r."codigo", false, NULL, 'total'
FROM "planos" p
CROSS JOIN (VALUES ('financeiro'), ('agendamento_online'), ('lista_espera'), ('documentos_pdf'), ('retorno_automatico'), ('dashboard')) AS r("codigo")
ON CONFLICT ("plano_id", "recurso_codigo") DO NOTHING;
