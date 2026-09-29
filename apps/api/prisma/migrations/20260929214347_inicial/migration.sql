-- CreateEnum
CREATE TYPE "papel_usuario" AS ENUM ('admin', 'recepcao', 'profissional');

-- CreateEnum
CREATE TYPE "status_clinica" AS ENUM ('ativa', 'inativa');

-- CreateEnum
CREATE TYPE "status_assinatura" AS ENUM ('teste', 'ativa', 'vencida', 'cancelada', 'bloqueada');

-- CreateEnum
CREATE TYPE "tipo_recurso" AS ENUM ('limite', 'booleano');

-- CreateEnum
CREATE TYPE "periodo_limite" AS ENUM ('total', 'mensal');

-- CreateEnum
CREATE TYPE "sexo" AS ENUM ('feminino', 'masculino', 'outro');

-- CreateEnum
CREATE TYPE "status_agendamento" AS ENUM ('agendado', 'confirmado', 'compareceu', 'atendido', 'cancelado', 'faltou');

-- CreateEnum
CREATE TYPE "tipo_agendamento" AS ENUM ('particular', 'convenio');

-- CreateEnum
CREATE TYPE "status_sessao_whatsapp" AS ENUM ('desconectada', 'iniciando', 'aguardando_qr', 'conectada', 'erro');

-- CreateEnum
CREATE TYPE "tipo_mensagem" AS ENUM ('lembrete', 'confirmacao', 'aviso');

-- CreateEnum
CREATE TYPE "direcao_mensagem" AS ENUM ('entrada', 'saida');

-- CreateEnum
CREATE TYPE "status_mensagem" AS ENUM ('pendente', 'enviada', 'falhou', 'recebida');

-- CreateTable
CREATE TABLE "usuarios_plataforma" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_plataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recursos" (
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "tipo" "tipo_recurso" NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recursos_pkey" PRIMARY KEY ("codigo")
);

-- CreateTable
CREATE TABLE "planos" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "preco" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "plano_cadastro" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plano_recursos" (
    "id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "recurso_codigo" TEXT NOT NULL,
    "habilitado" BOOLEAN NOT NULL DEFAULT true,
    "limite" INTEGER,
    "periodo" "periodo_limite" NOT NULL DEFAULT 'total',

    CONSTRAINT "plano_recursos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinicas" (
    "id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT NOT NULL,
    "responsavel" TEXT,
    "email" TEXT,
    "telefone" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "uf" VARCHAR(2),
    "cep" TEXT,
    "fuso_horario" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "status" "status_clinica" NOT NULL DEFAULT 'ativa',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assinaturas" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "plano_id" UUID NOT NULL,
    "status" "status_assinatura" NOT NULL DEFAULT 'teste',
    "inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expira_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assinaturas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "papel" "papel_usuario" NOT NULL,
    "profissional_id" UUID,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_acesso_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissionais" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "especialidade" TEXT,
    "registro" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "duracao_consulta_min" INTEGER NOT NULL DEFAULT 30,
    "cor_agenda" TEXT NOT NULL DEFAULT '#0d9488',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "profissionais_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profissional_horarios" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "dia_semana" SMALLINT NOT NULL,
    "hora_inicio" VARCHAR(5) NOT NULL,
    "hora_fim" VARCHAR(5) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profissional_horarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios_agenda" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "profissional_id" UUID,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_agenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convenios" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "convenios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "nascimento" DATE,
    "sexo" "sexo",
    "telefone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "convenio_id" UUID,
    "numero_carteirinha" TEXT,
    "contato_emergencia" TEXT,
    "aceita_whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "observacoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente_alergias" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "descricao" TEXT NOT NULL,
    "gravidade" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paciente_alergias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente_medicacoes" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "nome" TEXT NOT NULL,
    "dosagem" TEXT,
    "frequencia" TEXT,
    "observacoes" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paciente_medicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agendamentos" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "tipo" "tipo_agendamento" NOT NULL DEFAULT 'particular',
    "convenio_id" UUID,
    "status" "status_agendamento" NOT NULL DEFAULT 'agendado',
    "observacoes" TEXT,
    "criado_por" UUID,
    "lembrete_enviado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prontuario_registros" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profissional_id" UUID,
    "agendamento_id" UUID,
    "autor_id" UUID,
    "texto" TEXT NOT NULL,
    "corrige_registro_id" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prontuario_registros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anexos" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "registro_id" UUID,
    "nome_arquivo" TEXT NOT NULL,
    "caminho" TEXT NOT NULL,
    "mime_tipo" TEXT,
    "tamanho" INTEGER NOT NULL,
    "enviado_por" UUID,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "anexos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessoes" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "nome_sessao" TEXT NOT NULL,
    "token" TEXT,
    "status" "status_sessao_whatsapp" NOT NULL DEFAULT 'desconectada',
    "telefone" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensagens_whatsapp" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "agendamento_id" UUID,
    "paciente_id" UUID,
    "telefone" TEXT NOT NULL,
    "tipo" "tipo_mensagem",
    "direcao" "direcao_mensagem" NOT NULL,
    "conteudo" TEXT NOT NULL,
    "status" "status_mensagem" NOT NULL DEFAULT 'pendente',
    "erro" TEXT,
    "id_externo" TEXT,
    "enviada_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mensagens_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "logs_acesso" (
    "id" UUID NOT NULL,
    "clinica_id" UUID NOT NULL,
    "usuario_id" UUID,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidade_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "logs_acesso_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_plataforma_email_key" ON "usuarios_plataforma"("email");

-- CreateIndex
CREATE UNIQUE INDEX "plano_recursos_plano_id_recurso_codigo_key" ON "plano_recursos"("plano_id", "recurso_codigo");

-- CreateIndex
CREATE UNIQUE INDEX "clinicas_documento_key" ON "clinicas"("documento");

-- CreateIndex
CREATE UNIQUE INDEX "assinaturas_clinica_id_key" ON "assinaturas"("clinica_id");

-- CreateIndex
CREATE INDEX "assinaturas_plano_id_idx" ON "assinaturas"("plano_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_profissional_id_key" ON "usuarios"("profissional_id");

-- CreateIndex
CREATE INDEX "usuarios_clinica_id_idx" ON "usuarios"("clinica_id");

-- CreateIndex
CREATE INDEX "usuarios_email_idx" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_clinica_id_email_key" ON "usuarios"("clinica_id", "email");

-- CreateIndex
CREATE INDEX "profissionais_clinica_id_idx" ON "profissionais"("clinica_id");

-- CreateIndex
CREATE INDEX "profissionais_clinica_id_ativo_idx" ON "profissionais"("clinica_id", "ativo");

-- CreateIndex
CREATE INDEX "profissional_horarios_clinica_id_idx" ON "profissional_horarios"("clinica_id");

-- CreateIndex
CREATE INDEX "profissional_horarios_clinica_id_profissional_id_idx" ON "profissional_horarios"("clinica_id", "profissional_id");

-- CreateIndex
CREATE INDEX "bloqueios_agenda_clinica_id_idx" ON "bloqueios_agenda"("clinica_id");

-- CreateIndex
CREATE INDEX "bloqueios_agenda_clinica_id_inicio_idx" ON "bloqueios_agenda"("clinica_id", "inicio");

-- CreateIndex
CREATE INDEX "convenios_clinica_id_idx" ON "convenios"("clinica_id");

-- CreateIndex
CREATE UNIQUE INDEX "convenios_clinica_id_nome_key" ON "convenios"("clinica_id", "nome");

-- CreateIndex
CREATE INDEX "pacientes_clinica_id_idx" ON "pacientes"("clinica_id");

-- CreateIndex
CREATE INDEX "pacientes_clinica_id_nome_idx" ON "pacientes"("clinica_id", "nome");

-- CreateIndex
CREATE INDEX "pacientes_clinica_id_whatsapp_idx" ON "pacientes"("clinica_id", "whatsapp");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_clinica_id_cpf_key" ON "pacientes"("clinica_id", "cpf");

-- CreateIndex
CREATE INDEX "paciente_alergias_clinica_id_paciente_id_idx" ON "paciente_alergias"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "paciente_medicacoes_clinica_id_paciente_id_idx" ON "paciente_medicacoes"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "agendamentos_clinica_id_idx" ON "agendamentos"("clinica_id");

-- CreateIndex
CREATE INDEX "agendamentos_clinica_id_inicio_idx" ON "agendamentos"("clinica_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_clinica_id_profissional_id_inicio_idx" ON "agendamentos"("clinica_id", "profissional_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_clinica_id_paciente_id_idx" ON "agendamentos"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "agendamentos_clinica_id_criado_em_idx" ON "agendamentos"("clinica_id", "criado_em");

-- CreateIndex
CREATE INDEX "prontuario_registros_clinica_id_idx" ON "prontuario_registros"("clinica_id");

-- CreateIndex
CREATE INDEX "prontuario_registros_clinica_id_paciente_id_criado_em_idx" ON "prontuario_registros"("clinica_id", "paciente_id", "criado_em");

-- CreateIndex
CREATE INDEX "anexos_clinica_id_idx" ON "anexos"("clinica_id");

-- CreateIndex
CREATE INDEX "anexos_clinica_id_paciente_id_idx" ON "anexos"("clinica_id", "paciente_id");

-- CreateIndex
CREATE INDEX "anexos_clinica_id_criado_em_idx" ON "anexos"("clinica_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessoes_clinica_id_key" ON "whatsapp_sessoes"("clinica_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessoes_nome_sessao_key" ON "whatsapp_sessoes"("nome_sessao");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_clinica_id_idx" ON "mensagens_whatsapp"("clinica_id");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_clinica_id_criado_em_idx" ON "mensagens_whatsapp"("clinica_id", "criado_em");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_clinica_id_direcao_status_idx" ON "mensagens_whatsapp"("clinica_id", "direcao", "status");

-- CreateIndex
CREATE INDEX "mensagens_whatsapp_clinica_id_telefone_idx" ON "mensagens_whatsapp"("clinica_id", "telefone");

-- CreateIndex
CREATE INDEX "logs_acesso_clinica_id_criado_em_idx" ON "logs_acesso"("clinica_id", "criado_em");

-- CreateIndex
CREATE INDEX "logs_acesso_clinica_id_entidade_entidade_id_idx" ON "logs_acesso"("clinica_id", "entidade", "entidade_id");

-- AddForeignKey
ALTER TABLE "plano_recursos" ADD CONSTRAINT "plano_recursos_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plano_recursos" ADD CONSTRAINT "plano_recursos_recurso_codigo_fkey" FOREIGN KEY ("recurso_codigo") REFERENCES "recursos"("codigo") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assinaturas" ADD CONSTRAINT "assinaturas_plano_id_fkey" FOREIGN KEY ("plano_id") REFERENCES "planos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissionais" ADD CONSTRAINT "profissionais_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional_horarios" ADD CONSTRAINT "profissional_horarios_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profissional_horarios" ADD CONSTRAINT "profissional_horarios_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios_agenda" ADD CONSTRAINT "bloqueios_agenda_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios_agenda" ADD CONSTRAINT "bloqueios_agenda_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convenios" ADD CONSTRAINT "convenios_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_convenio_id_fkey" FOREIGN KEY ("convenio_id") REFERENCES "convenios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_alergias" ADD CONSTRAINT "paciente_alergias_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_alergias" ADD CONSTRAINT "paciente_alergias_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_medicacoes" ADD CONSTRAINT "paciente_medicacoes_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_medicacoes" ADD CONSTRAINT "paciente_medicacoes_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_convenio_id_fkey" FOREIGN KEY ("convenio_id") REFERENCES "convenios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_criado_por_fkey" FOREIGN KEY ("criado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_corrige_registro_id_fkey" FOREIGN KEY ("corrige_registro_id") REFERENCES "prontuario_registros"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_registro_id_fkey" FOREIGN KEY ("registro_id") REFERENCES "prontuario_registros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anexos" ADD CONSTRAINT "anexos_enviado_por_fkey" FOREIGN KEY ("enviado_por") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_sessoes" ADD CONSTRAINT "whatsapp_sessoes_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensagens_whatsapp" ADD CONSTRAINT "mensagens_whatsapp_paciente_id_fkey" FOREIGN KEY ("paciente_id") REFERENCES "pacientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_acesso" ADD CONSTRAINT "logs_acesso_clinica_id_fkey" FOREIGN KEY ("clinica_id") REFERENCES "clinicas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "logs_acesso" ADD CONSTRAINT "logs_acesso_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
