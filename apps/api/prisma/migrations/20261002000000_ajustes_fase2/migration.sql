-- Ajustes de integração da fase 2 do produto.
--   1. titulos.agendamento_id (FK opcional) substitui o marcador "[agendamento:<id>]" em observacoes.
--   2. gateways_pagamento.dia_vencimento_padrao / descricao_cobranca saem do JSON cifrado e viram colunas.
--   3. assinaturas.metodo_cobranca: método preferido da cobrança automática.

-- AlterTable
ALTER TABLE "assinaturas" ADD COLUMN     "metodo_cobranca" "metodo_cobranca";

-- AlterTable
ALTER TABLE "gateways_pagamento" ADD COLUMN     "descricao_cobranca" TEXT NOT NULL DEFAULT 'Mensalidade do sistema — plano {plano} ({competencia})',
ADD COLUMN     "dia_vencimento_padrao" SMALLINT NOT NULL DEFAULT 10;

ALTER TABLE "gateways_pagamento" ADD CONSTRAINT "gateways_pagamento_dia_vencimento_padrao_check"
  CHECK ("dia_vencimento_padrao" BETWEEN 1 AND 28);

-- AlterTable
ALTER TABLE "titulos" ADD COLUMN     "agendamento_id" UUID;

-- CreateIndex
CREATE INDEX "titulos_clinica_id_agendamento_id_idx" ON "titulos"("clinica_id", "agendamento_id");

-- AddForeignKey
ALTER TABLE "titulos" ADD CONSTRAINT "titulos_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migração de dados: marcador "[agendamento:<uuid>]" no fim de observacoes ⇒ coluna agendamento_id
-- (só quando o agendamento existe e é da mesma clínica); o marcador é removido do texto.
UPDATE "titulos" t
SET "agendamento_id" = a."id"
FROM "agendamentos" a
WHERE t."observacoes" ~* '\[agendamento:[0-9a-f-]{36}\]\s*$'
  AND a."id" = lower(substring(t."observacoes" from '(?i)\[agendamento:([0-9a-f-]{36})\]\s*$'))::uuid
  AND a."clinica_id" = t."clinica_id";

UPDATE "titulos"
SET "observacoes" = NULLIF(btrim(regexp_replace("observacoes", '\s*\[agendamento:[0-9a-fA-F-]{36}\]\s*$', '')), '')
WHERE "observacoes" ~* '\[agendamento:[0-9a-f-]{36}\]\s*$';
