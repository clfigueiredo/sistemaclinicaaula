// Aba "Documentos" da ficha do paciente (receitas, atestados, declarações, pedidos de exame em PDF).
// Exibida pela FichaPaciente para PAPEIS_ROTA.documentos (admin, profissional) quando o plano tem `documentos_pdf`.
// Documentos são IMUTÁVEIS (sem editar/excluir; correção = novo documento). O PDF é gerado pelo servidor sob
// demanda (rota autenticada, com log de acesso) e aberto numa nova aba via Blob.
import { useState } from 'react';
import { toast } from 'sonner';
import { ClipboardList, ExternalLink, FileCheck2, FileText, Loader2, Lock, Pill, Plus, Stamp } from 'lucide-react';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { abrirPdfDocumento, useDocumentosPaciente } from '@/api/documentos';
import { useMe } from '@/api/me';
import { usePaciente } from '@/api/pacientes';
import { ROTULOS_TIPO_DOCUMENTO, type TipoDocumentoClinico } from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora } from '@/lib/formatos';
import { NovoDocumento } from '../documentos/NovoDocumento';

const ICONES: Record<TipoDocumentoClinico, typeof Pill> = {
  receita: Pill,
  atestado: Stamp,
  declaracao: FileCheck2,
  pedido_exame: ClipboardList,
};

export default function AbaDocumentos({ pacienteId }: { pacienteId: string }) {
  const { data: me } = useMe();
  const { data: paciente } = usePaciente(pacienteId);
  const { data: documentos, isLoading, error } = useDocumentosPaciente(pacienteId);
  const [novoAberto, setNovoAberto] = useState(false);
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const profissionalId = me?.usuario.profissionalId ?? null;

  if (isLoading) return <Carregando />;
  if (error) {
    const negado = error instanceof ErroApi && error.status === 403;
    return (
      <EstadoVazio
        icone={<Lock className="size-5" />}
        titulo={negado ? 'Acesso aos documentos restrito' : 'Não foi possível carregar os documentos'}
        descricao={mensagemDeErro(error)}
      />
    );
  }

  async function verPdf(id: string) {
    setAbrindo(id);
    try {
      await abrirPdfDocumento(id);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setAbrindo(null);
    }
  }

  const botaoNovo = profissionalId ? (
    <Button onClick={() => setNovoAberto(true)} disabled={!paciente}>
      <Plus className="size-4" /> Novo documento
    </Button>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Receitas, atestados, declarações e pedidos de exame. Documentos emitidos não podem ser alterados nem
          excluídos — para corrigir, emita um novo.
        </p>
        {botaoNovo}
      </div>

      {!profissionalId && (
        <Alert>
          <Lock className="size-4" />
          <AlertDescription>
            Somente usuários vinculados a um profissional emitem documentos. Você pode consultar os já emitidos.
          </AlertDescription>
        </Alert>
      )}

      {!documentos || documentos.length === 0 ? (
        <EstadoVazio
          icone={<FileText className="size-5" />}
          titulo="Nenhum documento emitido"
          descricao="Os documentos emitidos para este paciente aparecerão aqui, do mais recente para o mais antigo."
          acao={botaoNovo ?? undefined}
        />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead className="hidden sm:table-cell">Emitido em</TableHead>
                <TableHead className="hidden md:table-cell">Profissional</TableHead>
                <TableHead className="w-28 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documentos.map((d) => {
                const Icone = ICONES[d.tipo];
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icone className="size-4 shrink-0 text-primary" />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2 font-medium">
                            {d.titulo || ROTULOS_TIPO_DOCUMENTO[d.tipo]}
                            <Badge variant="secondary">{ROTULOS_TIPO_DOCUMENTO[d.tipo]}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground sm:hidden">{formatarDataHora(d.criado_em)}</div>
                          <div className="text-xs text-muted-foreground md:hidden">{d.profissional.nome}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">{formatarDataHora(d.criado_em)}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      {d.profissional.nome}
                      {d.profissional.registro && (
                        <span className="text-muted-foreground"> · {d.profissional.registro}</span>
                      )}
                      {d.autor && d.autor.nome !== d.profissional.nome && (
                        <div className="text-xs text-muted-foreground">emitido por {d.autor.nome}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" onClick={() => verPdf(d.id)} disabled={abrindo === d.id}>
                        {abrindo === d.id ? <Loader2 className="animate-spin" /> : <ExternalLink />}
                        Ver PDF
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {profissionalId && paciente && (
        <NovoDocumento
          aberto={novoAberto}
          onOpenChange={setNovoAberto}
          pacienteId={pacienteId}
          pacienteNome={paciente.nome}
          profissionalId={profissionalId}
        />
      )}
    </div>
  );
}
