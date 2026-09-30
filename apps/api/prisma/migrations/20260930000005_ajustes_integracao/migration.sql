-- Ajustes de integração (fase 3).

-- Agendamentos: motivo e data do cancelamento em colunas próprias (antes ia para observacoes).
ALTER TABLE "agendamentos" ADD COLUMN "cancelado_em" TIMESTAMP(3),
ADD COLUMN "motivo_cancelamento" TEXT;

-- Mensagens WhatsApp: avisos à recepção passam a usar lida_em (antes: status pendente = não lido).
ALTER TABLE "mensagens_whatsapp" ADD COLUMN "lida_em" TIMESTAMP(3);

-- Migra os avisos existentes: status "recebida" era o marcador de lido.
UPDATE "mensagens_whatsapp" SET "lida_em" = COALESCE("enviada_em", "criado_em")
WHERE "tipo" = 'aviso' AND "status" = 'recebida';
UPDATE "mensagens_whatsapp" SET "status" = 'recebida'
WHERE "tipo" = 'aviso' AND "status" = 'pendente';

-- Idempotência do webhook: uma mensagem de entrada do provedor só é gravada uma vez por clínica.
-- (Segunda barreira; a primeira é o advisory lock + verificação em servicos/whatsapp/respostas.ts.)
CREATE UNIQUE INDEX "mensagens_whatsapp_entrada_id_externo_key"
ON "mensagens_whatsapp" ("clinica_id", "id_externo")
WHERE "direcao" = 'entrada' AND "id_externo" IS NOT NULL;
