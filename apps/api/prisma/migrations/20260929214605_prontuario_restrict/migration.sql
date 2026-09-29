-- DropForeignKey
ALTER TABLE "prontuario_registros" DROP CONSTRAINT "prontuario_registros_agendamento_id_fkey";

-- DropForeignKey
ALTER TABLE "prontuario_registros" DROP CONSTRAINT "prontuario_registros_autor_id_fkey";

-- DropForeignKey
ALTER TABLE "prontuario_registros" DROP CONSTRAINT "prontuario_registros_profissional_id_fkey";

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_profissional_id_fkey" FOREIGN KEY ("profissional_id") REFERENCES "profissionais"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_agendamento_id_fkey" FOREIGN KEY ("agendamento_id") REFERENCES "agendamentos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prontuario_registros" ADD CONSTRAINT "prontuario_registros_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
