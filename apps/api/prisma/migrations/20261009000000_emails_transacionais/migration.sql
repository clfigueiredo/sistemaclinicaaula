-- E-mails transacionais: configuração SMTP (super admin), modelos editáveis, histórico de envios e tokens de
-- redefinição de senha. Tabelas de plataforma (acesso só pelo prisma cru).

-- CreateEnum
CREATE TYPE "tipo_email" AS ENUM ('boas_vindas', 'redefinir_senha', 'pagamento_confirmado', 'aviso_renovacao', 'pagamento_renovado');

-- CreateEnum
CREATE TYPE "status_email" AS ENUM ('pendente', 'enviado', 'falhou', 'ignorado');

-- CreateTable
CREATE TABLE "configuracao_email" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "smtp_host" TEXT NOT NULL DEFAULT 'smtp.resend.com',
    "smtp_porta" INTEGER NOT NULL DEFAULT 465,
    "smtp_seguro" BOOLEAN NOT NULL DEFAULT true,
    "smtp_usuario" TEXT NOT NULL DEFAULT 'resend',
    "smtp_senha_cifrada" TEXT,
    "smtp_senha_final" VARCHAR(4),
    "remetente_nome" TEXT NOT NULL DEFAULT 'Sistema Clínica',
    "remetente_email" TEXT,
    "responder_para" TEXT,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "configuracao_email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "modelos_email" (
    "tipo" "tipo_email" NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "texto_botao" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "modelos_email_pkey" PRIMARY KEY ("tipo")
);

-- CreateTable
CREATE TABLE "emails_enviados" (
    "id" UUID NOT NULL,
    "tipo" "tipo_email" NOT NULL,
    "referencia" TEXT,
    "clinica_id" UUID,
    "destinatario" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "status" "status_email" NOT NULL DEFAULT 'pendente',
    "erro" TEXT,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "id_externo" TEXT,
    "enviado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emails_enviados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tokens_redefinicao_senha" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tokens_redefinicao_senha_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "emails_enviados_criado_em_idx" ON "emails_enviados"("criado_em");

-- CreateIndex
CREATE INDEX "emails_enviados_status_criado_em_idx" ON "emails_enviados"("status", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "emails_enviados_tipo_referencia_destinatario_key" ON "emails_enviados"("tipo", "referencia", "destinatario");

-- CreateIndex
CREATE UNIQUE INDEX "tokens_redefinicao_senha_token_hash_key" ON "tokens_redefinicao_senha"("token_hash");

-- CreateIndex
CREATE INDEX "tokens_redefinicao_senha_usuario_id_idx" ON "tokens_redefinicao_senha"("usuario_id");

-- AddForeignKey
ALTER TABLE "emails_enviados" ADD CONSTRAINT "emails_enviados_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_redefinicao_senha" ADD CONSTRAINT "tokens_redefinicao_senha_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

