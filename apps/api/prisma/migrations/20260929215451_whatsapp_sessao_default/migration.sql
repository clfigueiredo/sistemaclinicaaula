-- AlterTable
ALTER TABLE "agendamentos" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "anexos" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "bloqueios_agenda" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "convenios" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "logs_acesso" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "mensagens_whatsapp" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "paciente_alergias" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "paciente_medicacoes" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "pacientes" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "profissionais" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "profissional_horarios" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "prontuario_registros" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "usuarios" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;

-- AlterTable
ALTER TABLE "whatsapp_sessoes" ALTER COLUMN "clinica_id" SET DEFAULT (current_setting('app.clinica_id'))::uuid;
