/**
 * Anexos do prontuário (exames, laudos, imagens).
 *
 *   GET  /prontuario/pacientes/:pacienteId/anexos   lista (admin, profissional do paciente)
 *   POST /prontuario/pacientes/:pacienteId/anexos   multipart: campo `arquivo` (+ `registro_id` opcional, enviado ANTES do arquivo
 *                                                   ou como querystring ?registroId=). Limite `max_anexos` do plano.
 *   GET  /prontuario/anexos/:id/download            stream autenticado + logAcesso('baixar')
 *
 * - Tipos aceitos: PDF, JPG, PNG, WEBP e DICOM (.dcm). Tamanho máximo: UPLOAD_MAX_MB (multipart do app).
 * - Arquivo gravado com nome aleatório em UPLOAD_DIR/<clinica_id>/; `anexos.caminho` guarda o caminho relativo.
 * - Sem exclusão: anexos fazem parte do prontuário (imutável) e o limite do plano conta anexos criados.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { env } from '../../config/env';
import { assegurarLimite } from '../../plugins/recursos';
import { ErroNegocio, erros, ou404 } from '../../utils/erros';
import { logAcesso } from '../../utils/logAcesso';
import { assegurarAcessoProntuario } from './acesso';

type TipoPermitido = { mime: string; assinatura?: (b: Buffer) => boolean };

const TIPOS: Record<string, TipoPermitido> = {
  pdf: { mime: 'application/pdf', assinatura: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  jpg: { mime: 'image/jpeg', assinatura: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: 'image/jpeg', assinatura: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png: {
    mime: 'image/png',
    assinatura: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  webp: {
    mime: 'image/webp',
    assinatura: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  },
  dcm: { mime: 'application/dicom' },
};

const erroTipo = () =>
  new ErroNegocio(400, 'tipo_arquivo_invalido', 'Tipo de arquivo não permitido. Envie PDF, JPG, PNG, WEBP ou DICOM (.dcm).');

const SELECT_ANEXO = {
  id: true,
  paciente_id: true,
  registro_id: true,
  nome_arquivo: true,
  mime_tipo: true,
  tamanho: true,
  criado_em: true,
  usuario: { select: { id: true, nome: true } },
} as const;

/** Resolve o caminho absoluto garantindo que fica dentro de UPLOAD_DIR/<clinica_id>. */
function caminhoAbsoluto(clinicaId: string, relativo: string): string {
  const base = path.resolve(env.UPLOAD_DIR_ABS, clinicaId);
  const abs = path.resolve(env.UPLOAD_DIR_ABS, relativo);
  if (!abs.startsWith(base + path.sep)) throw erros.naoEncontrado('Arquivo não encontrado.');
  return abs;
}

/** Nome de arquivo seguro para exibição/Content-Disposition. */
function limparNome(nome: string): string {
  const base = path.basename(nome.replace(/\\/g, '/')).replace(/[\u0000-\u001f"]/g, '').trim();
  return (base || 'arquivo').slice(0, 200);
}

const ParamsPaciente = z.object({ pacienteId: z.uuid('Paciente inválido') });

export const rotasAnexos: FastifyPluginAsyncZod = async (app) => {
  app.get('/pacientes/:pacienteId/anexos', { schema: { params: ParamsPaciente } }, async (request) => {
    const { pacienteId } = request.params;
    await assegurarAcessoProntuario(request, pacienteId);
    const anexos = await request.db.anexo.findMany({
      where: { paciente_id: pacienteId },
      select: SELECT_ANEXO,
      orderBy: { criado_em: 'desc' },
    });
    await logAcesso(request, 'listar', 'anexo', pacienteId);
    return anexos;
  });

  app.post(
    '/pacientes/:pacienteId/anexos',
    {
      schema: {
        params: ParamsPaciente,
        querystring: z.object({ registroId: z.uuid('Registro inválido').optional() }),
      },
    },
    async (request, reply) => {
      const { pacienteId } = request.params;
      const clinicaId = request.clinicaId;
      await assegurarAcessoProntuario(request, pacienteId);
      // Pré-checagem (evita receber o arquivo à toa); a checagem definitiva é na transação.
      await assegurarLimite(clinicaId, 'max_anexos');

      if (!request.isMultipart()) throw erros.invalido('Envie o arquivo como multipart/form-data.', 'arquivo_ausente');
      const parte = await request.file();
      if (!parte) throw erros.invalido('Nenhum arquivo enviado.', 'arquivo_ausente');

      const nomeOriginal = limparNome(parte.filename);
      const extensao = path.extname(nomeOriginal).slice(1).toLowerCase();
      const tipo = TIPOS[extensao];
      if (!tipo) {
        parte.file.resume();
        throw erroTipo();
      }
      const buffer = await parte.toBuffer(); // estouro de tamanho ⇒ 413
      if (buffer.length === 0) throw erros.invalido('O arquivo está vazio.', 'arquivo_vazio');
      if (tipo.assinatura && !tipo.assinatura(buffer)) throw erroTipo();

      // registro_id: campo do formulário (antes do arquivo) ou querystring.
      const campo = parte.fields.registro_id;
      const campoValor =
        campo && !Array.isArray(campo) && 'value' in campo && typeof campo.value === 'string' ? campo.value : undefined;
      const registroId = request.query.registroId ?? (campoValor || undefined);
      if (registroId) {
        if (!z.uuid().safeParse(registroId).success) throw erros.invalido('Registro inválido.');
        ou404(
          await request.db.prontuarioRegistro.findFirst({
            where: { id: registroId, paciente_id: pacienteId },
            select: { id: true },
          }),
          'Registro de prontuário não encontrado.',
        );
      }

      const relativo = `${clinicaId}/${randomUUID()}.${extensao}`;
      const absoluto = caminhoAbsoluto(clinicaId, relativo);
      await fsp.mkdir(path.dirname(absoluto), { recursive: true });

      let gravado = false;
      try {
        const anexo = await request.db.$transaction(async (tx) => {
          await assegurarLimite(clinicaId, 'max_anexos', { tx });
          await fsp.writeFile(absoluto, buffer, { flag: 'wx' });
          gravado = true;
          return tx.anexo.create({
            data: {
              paciente_id: pacienteId,
              registro_id: registroId ?? null,
              nome_arquivo: nomeOriginal,
              caminho: relativo,
              mime_tipo: tipo.mime,
              tamanho: buffer.length,
              enviado_por: request.usuarioClinica!.id,
            },
            select: SELECT_ANEXO,
          });
        });
        await logAcesso(request, 'criar', 'anexo', anexo.id);
        return reply.status(201).send(anexo);
      } catch (e) {
        if (gravado) await fsp.rm(absoluto, { force: true });
        throw e;
      }
    },
  );

  app.get(
    '/anexos/:id/download',
    { schema: { params: z.object({ id: z.uuid('Anexo inválido') }) } },
    async (request, reply) => {
      const anexo = ou404(await request.db.anexo.findUnique({ where: { id: request.params.id } }), 'Anexo não encontrado.');
      await assegurarAcessoProntuario(request, anexo.paciente_id);
      const absoluto = caminhoAbsoluto(request.clinicaId, anexo.caminho);
      try {
        await fsp.access(absoluto, fs.constants.R_OK);
      } catch {
        throw new ErroNegocio(404, 'arquivo_nao_encontrado', 'O arquivo deste anexo não foi encontrado no servidor.');
      }
      await logAcesso(request, 'baixar', 'anexo', anexo.id);

      const nome = limparNome(anexo.nome_arquivo);
      const ascii = nome.replace(/[^\x20-\x7e]/g, '_');
      return reply
        .header('Content-Type', anexo.mime_tipo ?? 'application/octet-stream')
        .header('Content-Length', String(anexo.tamanho))
        .header('Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`)
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .send(fs.createReadStream(absoluto));
    },
  );
};
