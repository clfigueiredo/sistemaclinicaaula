/**
 * Registro de TODOS os módulos da API. Cada módulo vive em src/modulos/<nome>/index.ts e exporta:
 *   - `default`: plugin Fastify (FastifyPluginAsyncZod)
 *   - `prefixo`: prefixo das rotas (ex.: '/pacientes')
 *
 * Todos os módulos previstos (MVP + fase 2 do produto) já estão importados aqui. Os agentes/módulos NÃO
 * precisam editar este arquivo: basta implementar o index.ts do próprio módulo (contratos em docs/FASE2.md).
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
// Fase 2 do produto (contratos em docs/FASE2.md)
import * as financeiro from './financeiro';
import * as agendamentoOnline from './agendamento-online';
import * as listaEspera from './lista-espera';
import * as documentos from './documentos';
import * as retornos from './retornos';
import * as dashboard from './dashboard';
import * as adminCobranca from './admin-cobranca';
// Contratação de plano pela clínica + planos da landing page
import * as contratacao from './contratacao';

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
  financeiro,
  'agendamento-online': agendamentoOnline,
  'lista-espera': listaEspera,
  documentos,
  retornos,
  dashboard,
  'admin-cobranca': adminCobranca,
  contratacao,
};

export async function registrarModulos(app: FastifyInstance): Promise<void> {
  for (const modulo of Object.values(MODULOS)) {
    await app.register(modulo.default, { prefix: modulo.prefixo });
  }
}
