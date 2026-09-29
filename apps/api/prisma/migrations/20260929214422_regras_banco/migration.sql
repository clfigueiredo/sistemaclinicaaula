-- Regras de negócio garantidas no próprio banco (segunda barreira além do código).

-- 1) Só um plano pode estar marcado como plano_cadastro (plano do auto-cadastro).
CREATE UNIQUE INDEX "planos_plano_cadastro_unico" ON "planos" ("plano_cadastro") WHERE "plano_cadastro" = true;

-- 2) Prontuário imutável: sem UPDATE; DELETE só com a flag de sessão
--    `SET LOCAL app.permitir_exclusao_prontuario = 'on'` (uso exclusivo de rotinas
--    administrativas, ex.: exclusão definitiva de uma clínica). TRUNCATE (testes) não dispara o trigger.
CREATE OR REPLACE FUNCTION prontuario_imutavel() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'prontuario_registros é imutável: correção deve ser um novo registro';
  END IF;
  IF TG_OP = 'DELETE' AND coalesce(current_setting('app.permitir_exclusao_prontuario', true), '') <> 'on' THEN
    RAISE EXCEPTION 'prontuario_registros é imutável: exclusão não permitida';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER prontuario_registros_imutavel
  BEFORE UPDATE OR DELETE ON "prontuario_registros"
  FOR EACH ROW EXECUTE FUNCTION prontuario_imutavel();
