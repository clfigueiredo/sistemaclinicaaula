-- Segurança fase 2 (auditoria B3): ambiente do gateway gravado em cada cobrança.
ALTER TABLE "cobrancas" ADD COLUMN "ambiente" "ambiente_gateway";

-- Cobranças existentes: ambiente atual do gateway de origem (melhor informação disponível).
UPDATE "cobrancas" c SET "ambiente" = g."ambiente" FROM "gateways_pagamento" g WHERE g."provedor" = c."gateway" AND c."ambiente" IS NULL;
