/**
 * Módulo documentos — receituário, atestado, declaração e pedido de exame em PDF.   [STUB — fase 2]
 *
 * Contrato completo: docs/FASE2.md §4. Recurso do plano: `documentos_pdf`. Tabela: documentos_clinicos
 * (IMUTÁVEL: extensão tenant lança 403 `documento_imutavel` em update/delete + trigger no banco).
 *
 * Rotas (prefixo "/documentos"; autenticarClinica + exigirRecurso('documentos_pdf')):
 *   GET  /documentos/pacientes/:pacienteId      admin, profissional   lista (sem `conteudo`), mais recentes primeiro
 *   GET  /documentos/:id                        admin, profissional   detalhe
 *   POST /documentos                            admin*, profissional  { paciente_id, tipo, conteudo, titulo?, agendamento_id?, metadados? }
 *   GET  /documentos/:id/pdf                    admin, profissional   application/pdf (Content-Disposition inline)
 *   Sem PUT/DELETE. Correção = novo documento.
 *
 * Regras (as mesmas do prontuário — reuse modulos/prontuario/acesso.ts):
 *   - Recepção NÃO acessa (403). `assegurarAcessoProntuario(request, pacienteId)` em TODAS as rotas
 *     (vínculo profissional–paciente; profissional inativo ⇒ 403).
 *   - Emissão: `profissional_id = await profissionalAutor(request)` (*admin só se vinculado a profissional ativo);
 *     `autor_id` = usuário logado. Valide agendamento_id (mesmo paciente).
 *   - LGPD: logAcesso(request, 'listar' | 'visualizar' | 'criar' | 'baixar', 'documento_clinico', id).
 *   - PDF com pdfkit (já instalado): cabeçalho com nome/documento/endereço/telefone da clínica; título do tipo;
 *     paciente (nome, CPF se houver); conteúdo; data por extenso no fuso da clínica; rodapé com nome +
 *     registro (CRM/CRO…) do profissional e o id do documento. Gere em memória (não grave em disco).
 *   - Testes que criarem documentos: para apagar a clínica no cleanup use
 *     `SET LOCAL app.permitir_exclusao_prontuario = 'on'` numa transação (trigger bloqueia DELETE).
 */
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { autenticarClinica } from '../../plugins/auth';
import { exigirRecurso } from '../../plugins/recursos';

export const prefixo = '/documentos';

const modulo: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', autenticarClinica);
  app.addHook('preHandler', exigirRecurso('documentos_pdf'));
  // TODO(documentos): implementar as rotas acima.
};

export default modulo;
