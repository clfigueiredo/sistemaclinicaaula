/**
 * Registro de TODOS os módulos da API. Cada módulo vive em src/modulos/<nome>/index.ts e exporta:
 *   - `default`: plugin Fastify (FastifyPluginAsyncZod)
 *   - `prefixo`: prefixo das rotas (ex.: '/pacientes')
 *
 * Todos os módulos previstos já estão importados aqui. Os agentes/módulos da fase 2 NÃO precisam
 * editar este arquivo: basta implementar o index.ts do próprio módulo.
 */
import type { FastifyInstance } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import * as auth from './auth';
import * as me from './me';
import * as adminPlanos from './admin-planos';
import * as adminClinicas from './admin-clinicas';
import * as profissionais from './profissionais';
import * as convenios from './convenios';
import * as usuarios from './usuarios';
import * as pacientes from './pacientes';
import * as prontuario from './prontuario';
import * as agendamentos from './agendamentos';
import * as whatsapp from './whatsapp';

type ModuloApi = { default: FastifyPluginAsyncZod; prefixo: string };

export const MODULOS: Record<string, ModuloApi> = {
  auth,
  me,
  'admin-planos': adminPlanos,
  'admin-clinicas': adminClinicas,
  profissionais,
  convenios,
  usuarios,
  pacientes,
  prontuario,
  agendamentos,
  whatsapp,
};

export async function registrarModulos(app: FastifyInstance): Promise<void> {
  for (const modulo of Object.values(MODULOS)) {
    await app.register(modulo.default, { prefix: modulo.prefixo });
  }
}
