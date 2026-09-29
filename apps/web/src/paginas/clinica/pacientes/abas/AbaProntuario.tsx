// Aba "Prontuário" da ficha: linha do tempo de registros (imutáveis) + editor de novo registro/correção.
// Recepção não vê esta aba (a API também responde 403). Toda visualização/criação gera log de acesso no backend.
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { FileText, History, Loader2, Lock, Paperclip, PenLine, Undo2, X } from 'lucide-react';
import { useMe } from '@/api/me';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useConsultasPaciente } from '@/api/pacientes';
import { baixarAnexo, useCriarRegistro, useRegistrosProntuario, type RegistroProntuario } from '@/api/prontuario';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Textarea } from '@/componentes/ui/textarea';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';

const SEM_CONSULTA = '__sem__';

export default function AbaProntuario({ pacienteId }: { pacienteId: string }) {
  const { data: me } = useMe();
  const profissionalId = me?.usuario.profissionalId ?? null;
  const { data: registros, isLoading, error } = useRegistrosProntuario(pacienteId);
  const [corrigindo, setCorrigindo] = useState<RegistroProntuario | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  if (isLoading) return <Carregando />;
  if (error) {
    const negado = error instanceof ErroApi && error.status === 403;
    return (
      <EstadoVazio
        icone={<Lock className="size-5" />}
        titulo={negado ? 'Acesso ao prontuário restrito' : 'Não foi possível carregar o prontuário'}
        descricao={mensagemDeErro(error)}
      />
    );
  }

  const porId = new Map((registros ?? []).map((r) => [r.id, r]));

  function corrigir(r: RegistroProntuario) {
    setCorrigindo(r);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  return (
    <div className="space-y-6">
      <Alert>
        <Lock className="size-4" />
        <AlertTitle>Registros permanentes</AlertTitle>
        <AlertDescription>
          Registros do prontuário não podem ser alterados nem excluídos. Para corrigir uma informação, use
          “Corrigir”: um novo registro é criado e vinculado ao original. Todo acesso a este prontuário é registrado.
        </AlertDescription>
      </Alert>

      <div ref={editorRef} className="scroll-mt-4">
        {profissionalId ? (
          <EditorRegistro
            key={corrigindo?.id ?? 'novo'}
            pacienteId={pacienteId}
            profissionalId={profissionalId}
            corrigindo={corrigindo}
            onCancelarCorrecao={() => setCorrigindo(null)}
            onCriado={() => setCorrigindo(null)}
          />
        ) : (
          <Alert>
            <PenLine className="size-4" />
            <AlertDescription>
              Somente usuários vinculados a um profissional escrevem no prontuário. Você pode consultar os registros abaixo.
            </AlertDescription>
          </Alert>
        )}
      </div>

      {!registros || registros.length === 0 ? (
        <EstadoVazio
          icone={<FileText className="size-5" />}
          titulo="Nenhum registro no prontuário"
          descricao="Os atendimentos registrados aparecerão aqui, do mais recente para o mais antigo."
        />
      ) : (
        <ol className="relative space-y-4 border-l pl-6">
          {registros.map((r) => {
            const original = r.corrige_registro_id ? porId.get(r.corrige_registro_id) : undefined;
            const podeCorrigir = !!profissionalId && r.profissional_id === profissionalId;
            return (
              <li key={r.id} id={`registro-${r.id}`} className="relative scroll-mt-4">
                <span
                  className={cn(
                    'absolute top-5 -left-[31px] size-3 rounded-full border-2 border-background',
                    r.corrige_registro_id ? 'bg-warning' : 'bg-primary',
                  )}
                  aria-hidden
                />
                <Card className={cn('gap-3 py-4', r.correcoes.length > 0 && 'opacity-80')}>
                  <CardHeader className="px-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm">
                          {r.profissional?.nome ?? r.autor?.nome ?? 'Autor desconhecido'}
                          {r.profissional?.registro && (
                            <span className="font-normal text-muted-foreground"> · {r.profissional.registro}</span>
                          )}
                        </CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {formatarDataHora(r.criado_em)}
                          {r.profissional?.especialidade && ` · ${r.profissional.especialidade}`}
                          {r.agendamento && ` · consulta de ${formatarDataHora(r.agendamento.inicio)}`}
                          {r.autor && r.profissional && r.autor.nome !== r.profissional.nome && ` · escrito por ${r.autor.nome}`}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {r.corrige_registro_id && (
                          <Badge variant="outline" className="border-warning/60">
                            <Undo2 /> Correção
                          </Badge>
                        )}
                        {r.correcoes.length > 0 && (
                          <Badge variant="secondary">
                            <History /> Corrigido depois
                          </Badge>
                        )}
                        {podeCorrigir && (
                          <Button variant="outline" size="xs" onClick={() => corrigir(r)}>
                            <PenLine /> Corrigir
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 px-4">
                    {r.corrige_registro_id && (
                      <p className="text-xs text-muted-foreground">
                        Corrige o registro de{' '}
                        {original ? (
                          <a href={`#registro-${original.id}`} className="text-primary underline-offset-4 hover:underline">
                            {formatarDataHora(original.criado_em)}
                          </a>
                        ) : (
                          'um registro anterior'
                        )}
                        .
                      </p>
                    )}
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.texto}</p>
                    {r.anexos.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {r.anexos.map((a) => (
                          <Button
                            key={a.id}
                            variant="secondary"
                            size="xs"
                            onClick={() => baixarAnexo(a).catch((e) => toast.error(mensagemDeErro(e)))}
                          >
                            <Paperclip /> {a.nome_arquivo}
                          </Button>
                        ))}
                      </div>
                    )}
                    {r.correcoes.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Veja a correção de{' '}
                        {r.correcoes.map((c, i) => (
                          <span key={c.id}>
                            {i > 0 && ', '}
                            <a href={`#registro-${c.id}`} className="text-primary underline-offset-4 hover:underline">
                              {formatarDataHora(c.criado_em)}
                            </a>
                          </span>
                        ))}
                        .
                      </p>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function EditorRegistro({
  pacienteId,
  profissionalId,
  corrigindo,
  onCancelarCorrecao,
  onCriado,
}: {
  pacienteId: string;
  profissionalId: string;
  corrigindo: RegistroProntuario | null;
  onCancelarCorrecao: () => void;
  onCriado: () => void;
}) {
  const [texto, setTexto] = useState(corrigindo ? corrigindo.texto : '');
  const [agendamentoId, setAgendamentoId] = useState(corrigindo?.agendamento_id ?? SEM_CONSULTA);
  const criar = useCriarRegistro(pacienteId);
  const consultas = useConsultasPaciente(pacienteId);
  const minhasConsultas = (consultas.data ?? [])
    .filter((c) => c.profissional?.id === profissionalId && c.status !== 'cancelado')
    .slice(0, 20);

  async function salvar() {
    if (!texto.trim()) return;
    try {
      await criar.mutateAsync({
        texto: texto.trim(),
        agendamento_id: agendamentoId === SEM_CONSULTA ? null : agendamentoId,
        corrige_registro_id: corrigindo?.id ?? null,
      });
      toast.success(corrigindo ? 'Correção registrada.' : 'Registro adicionado ao prontuário.');
      setTexto('');
      setAgendamentoId(SEM_CONSULTA);
      onCriado();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <Card className={cn('gap-4', corrigindo && 'border-warning/60')}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="size-4 text-primary" />
            {corrigindo ? 'Correção de registro' : 'Novo registro'}
          </CardTitle>
          {corrigindo && (
            <Button variant="ghost" size="sm" onClick={onCancelarCorrecao}>
              <X /> Cancelar correção
            </Button>
          )}
        </div>
        {corrigindo && (
          <p className="text-xs text-muted-foreground">
            Corrigindo o registro de {formatarDataHora(corrigindo.criado_em)}. O original continuará visível na linha do
            tempo, marcado como corrigido.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          rows={6}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Queixa, anamnese, exame físico, hipóteses, conduta…"
          aria-label="Texto do registro"
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          {minhasConsultas.length > 0 ? (
            <div className="space-y-1.5 sm:w-72">
              <Label className="text-xs text-muted-foreground">Consulta relacionada (opcional)</Label>
              <Select value={agendamentoId} onValueChange={setAgendamentoId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_CONSULTA}>Nenhuma</SelectItem>
                  {minhasConsultas.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {formatarDataHora(c.inicio)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <span />
          )}
          <Button onClick={salvar} disabled={criar.isPending || !texto.trim()}>
            {criar.isPending && <Loader2 className="size-4 animate-spin" />}
            {corrigindo ? 'Registrar correção' : 'Salvar registro'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Após salvar, o registro não poderá ser editado nem excluído.
        </p>
      </CardContent>
    </Card>
  );
}
