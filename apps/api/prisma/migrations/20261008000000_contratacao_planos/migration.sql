-- Contratação de plano pela própria clínica (painel /planos) e planos exibidos na landing page.

-- AlterTable
ALTER TABLE "planos" ADD COLUMN     "contratavel" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exibir_landing" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "cobrancas" ADD COLUMN     "plano_contratado_id" UUID;

-- AddForeignKey
ALTER TABLE "cobrancas" ADD CONSTRAINT "cobrancas_plano_contratado_id_fkey" FOREIGN KEY ("plano_contratado_id") REFERENCES "planos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
