// Diálogo "Novo documento": formulário por tipo → pré-visualização do PDF (gerado pelo servidor, nada é gravado)
// → emissão. Depois de emitido o documento é imutável (correção = novo documento).
import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, ClipboardList, Eye, FileCheck2, FileText, Loader2, Lock, Pill, Plus, Stamp, Trash2 } from 'lucide-react';
import { mensagemDeErro } from '@/api/cliente';
import {
  abrirPdfDocumento,
  gerarPreviaDocumento,
  useEmitirDocumento,
  type ItemReceita,
  type NovoDocumento as DadosNovoDocumento,
} from '@/api/documentos';
import { useConsultasPaciente } from '@/api/pacientes';
import { ROTULOS_STATUS_AGENDAMENTO, ROTULOS_TIPO_DOCUMENTO, type TipoDocumentoClinico } from '@/api/tipos';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Button } from '@/componentes/ui/button';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Switch } from '@/componentes/ui/switch';
import { Textarea } from '@/componentes/ui/textarea';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { DESCRICOES_TIPO, modeloAtestado, modeloDeclaracao, TITULOS_PADRAO } from './modelos';

const SEM_CONSULTA = '__sem__';
const TIPOS: { tipo: TipoDocumentoClinico; icone: typeof Pill }[] = [
  { tipo: 'receita', icone: Pill },
  { tipo: 'atestado', icone: Stamp },
  { tipo: 'declaracao', icone: FileCheck2 },
  { tipo: 'pedido_exame', icone: ClipboardList },
];

const itemVazio = (): ItemReceita => ({ medicamento: '', quantidade: '', posologia: '' });
const hoje = () => format(new Date(), 'yyyy-MM-dd');

export function NovoDocumento({
  aberto,
  onOpenChange,
  pacienteId,
  pacienteNome,
  profissionalId,
}: {
  aberto: boolean;
  onOpenChange: (v: boolean) => void;
  pacienteId: string;
  pacienteNome: string;
  profissionalId: string;
}) {
  return (
    <Dialog open={aberto} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        {aberto && (
          <Formulario
            pacienteId={pacienteId}
            pacienteNome={pacienteNome}
            profissionalId={profissionalId}
            onFechar={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Formulario({
  pacienteId,
  pacienteNome,
  profissionalId,
  onFechar,
}: {
  pacienteId: string;
  pacienteNome: string;
  profissionalId: string;
  onFechar: () => void;
}) {
  const emitir = useEmitirDocumento(pacienteId);
  const consultas = useConsultasPaciente(pacienteId);
  const minhasConsultas = useMemo(
    () =>
      (consultas.data ?? [])
        .filter((c) => c.profissional?.id === profissionalId && c.status !== 'cancelado' && c.status !== 'faltou')
        .slice(0, 20),
    [consultas.data, profissionalId],
  );

  const [tipo, setTipo] = useState<TipoDocumentoClinico>('receita');
  const [titulo, setTitulo] = useState('');
  const [agendamentoId, setAgendamentoId] = useState(SEM_CONSULTA);

  // receita
  const [textoLivre, setTextoLivre] = useState(false);
  const [uso, setUso] = useState<'interno' | 'externo'>('interno');
  const [itens, setItens] = useState<ItemReceita[]>([itemVazio()]);
  const [orientacoes, setOrientacoes] = useState('');
  const [textoReceita, setTextoReceita] = useState('');
  // atestado
  const [dias, setDias] = useState('');
  const [autorizouCid, setAutorizouCid] = useState(false);
  const [cid, setCid] = useState('');
  // declaração
  const [dataDecl, setDataDecl] = useState(hoje());
  const [horaInicio, setHoraInicio] = useState('');
  const [horaFim, setHoraFim] = useState('');
  // pedido de exame
  const [exames, setExames] = useState('');
  const [indicacao, setIndicacao] = useState('');
  const [observacoesExame, setObservacoesExame] = useState('');
  // texto (atestado/declaração): modelo pré-preenchido até o usuário editar
  const [texto, setTexto] = useState('');
  const [textoEditado, setTextoEditado] = useState(false);

  const [previa, setPrevia] = useState<{ url: string; corpo: DadosNovoDocumento } | null>(null);
  const [gerandoPrevia, setGerandoPrevia] = useState(false);

  const diasNumero = /^\d+$/.test(dias) ? Number(dias) : null;
  const modelo =
    tipo === 'atestado'
      ? modeloAtestado(pacienteNome, diasNumero)
      : tipo === 'declaracao'
        ? modeloDeclaracao(pacienteNome, dataDecl, horaInicio, horaFim)
        : '';

  useEffect(() => {
    if (!textoEditado) setTexto(modelo);
  }, [modelo, textoEditado]);

  useEffect(() => () => {
    if (previa) URL.revokeObjectURL(previa.url);
  }, [previa]);

  function trocarTipo(novo: TipoDocumentoClinico) {
    setTipo(novo);
    setTextoEditado(false);
  }

  function escolherConsulta(id: string) {
    setAgendamentoId(id);
    const c = minhasConsultas.find((x) => x.id === id);
    if (c && tipo === 'declaracao') {
      setDataDecl(format(new Date(c.inicio), 'yyyy-MM-dd'));
      setHoraInicio(format(new Date(c.inicio), 'HH:mm'));
      setHoraFim(format(new Date(c.fim), 'HH:mm'));
    }
  }

  /** Monta o corpo da requisição ou devolve a mensagem de validação. */
  function montarCorpo(): DadosNovoDocumento | string {
    const base = {
      paciente_id: pacienteId,
      tipo,
      titulo: titulo.trim() || null,
      agendamento_id: agendamentoId === SEM_CONSULTA ? null : agendamentoId,
    };
    switch (tipo) {
      case 'receita': {
        if (textoLivre) {
          if (!textoReceita.trim()) return 'Escreva o texto da receita.';
          return { ...base, conteudo: textoReceita.trim(), metadados: { uso } };
        }
        const validos = itens
          .map((i) => ({
            medicamento: i.medicamento.trim(),
            quantidade: i.quantidade?.trim() || null,
            posologia: i.posologia?.trim() || null,
          }))
          .filter((i) => i.medicamento || i.posologia || i.quantidade);
        if (!validos.length) return 'Adicione ao menos um medicamento.';
        if (validos.some((i) => !i.medicamento)) return 'Informe o nome de todos os medicamentos.';
        return { ...base, conteudo: orientacoes.trim(), metadados: { uso, itens: validos } };
      }
      case 'atestado': {
        if (dias && (!diasNumero || diasNumero < 1 || diasNumero > 365)) return 'Dias de afastamento: de 1 a 365.';
        if (autorizouCid && !/^[A-Za-z]\d{2}(\.?\d{1,2})?$/.test(cid.trim())) return 'Informe um CID válido (ex.: J11 ou J11.1).';
        if (!texto.trim()) return 'Escreva o texto do atestado.';
        return {
          ...base,
          conteudo: texto.trim(),
          metadados: { dias: diasNumero, exibir_cid: autorizouCid, cid: autorizouCid ? cid.trim().toUpperCase() : null },
        };
      }
      case 'declaracao': {
        if (!dataDecl) return 'Informe a data do comparecimento.';
        if (!texto.trim()) return 'Escreva o texto da declaração.';
        return {
          ...base,
          conteudo: texto.trim(),
          metadados: { data: dataDecl, hora_inicio: horaInicio || null, hora_fim: horaFim || null },
        };
      }
      case 'pedido_exame': {
        const lista = exames
          .split('\n')
          .map((e) => e.trim())
          .filter(Boolean);
        if (!lista.length) return 'Informe ao menos um exame (um por linha).';
        if (lista.length > 50) return 'No máximo 50 exames por pedido.';
        return {
          ...base,
          conteudo: observacoesExame.trim(),
          metadados: { exames: lista, indicacao_clinica: indicacao.trim() || null },
        };
      }
    }
  }

  async function preVisualizar() {
    const corpo = montarCorpo();
    if (typeof corpo === 'string') {
      toast.error(corpo);
      return;
    }
    setGerandoPrevia(true);
    try {
      const blob = await gerarPreviaDocumento(corpo);
      setPrevia({ url: URL.createObjectURL(blob), corpo });
    } catch (e) {
      toast.error(mensagemDeErro(e));
    } finally {
      setGerandoPrevia(false);
    }
  }

  async function confirmarEmissao() {
    if (!previa) return;
    try {
      const doc = await emitir.mutateAsync(previa.corpo);
      toast.success(`${ROTULOS_TIPO_DOCUMENTO[doc.tipo]} emitido(a).`, {
        action: { label: 'Ver PDF', onClick: () => abrirPdfDocumento(doc.id).catch((e) => toast.error(mensagemDeErro(e))) },
      });
      onFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  if (previa) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Pré-visualização</DialogTitle>
          <DialogDescription>Confira o documento antes de emitir.</DialogDescription>
        </DialogHeader>
        <Alert className="border-warning/60">
          <Lock className="size-4" />
          <AlertTitle>Depois de emitido, o documento não poderá ser alterado nem excluído</AlertTitle>
          <AlertDescription>Para corrigir, será preciso emitir um novo documento.</AlertDescription>
        </Alert>
        <iframe
          title="Pré-visualização do documento"
          src={previa.url}
          className="h-[60vh] w-full rounded-md border bg-muted"
        />
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => setPrevia(null)} disabled={emitir.isPending}>
            <ArrowLeft className="size-4" /> Voltar e editar
          </Button>
          <Button onClick={confirmarEmissao} disabled={emitir.isPending}>
            {emitir.isPending ? <Loader2 className="size-4 animate-spin" /> : <FileCheck2 className="size-4" />}
            Emitir documento
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Novo documento</DialogTitle>
        <DialogDescription>Paciente: {pacienteNome}. O documento sai em seu nome, com seu registro profissional.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Tipo de documento">
        {TIPOS.map(({ tipo: t, icone: Icone }) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={tipo === t}
            onClick={() => trocarTipo(t)}
            className={cn(
              'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors hover:bg-accent',
              tipo === t && 'border-primary bg-primary/5 ring-1 ring-primary',
            )}
          >
            <Icone className={cn('size-4', tipo === t ? 'text-primary' : 'text-muted-foreground')} />
            <span className="text-sm font-medium">{ROTULOS_TIPO_DOCUMENTO[t]}</span>
            <span className="text-xs text-muted-foreground">{DESCRICOES_TIPO[t]}</span>
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="doc-titulo">Título (opcional)</Label>
            <Input id="doc-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder={TITULOS_PADRAO[tipo]} maxLength={120} />
          </div>
          <div className="space-y-1.5">
            <Label>Consulta relacionada (opcional)</Label>
            <Select value={agendamentoId} onValueChange={escolherConsulta}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_CONSULTA}>Nenhuma</SelectItem>
                {minhasConsultas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatarDataHora(c.inicio)} · {ROTULOS_STATUS_AGENDAMENTO[c.status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {tipo === 'receita' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-normal">Uso</Label>
                <Select value={uso} onValueChange={(v) => setUso(v as 'interno' | 'externo')}>
                  <SelectTrigger className="w-32" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="interno">Interno</SelectItem>
                    <SelectItem value="externo">Externo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="doc-texto-livre" checked={textoLivre} onCheckedChange={setTextoLivre} />
                <Label htmlFor="doc-texto-livre" className="text-sm font-normal">
                  Texto livre
                </Label>
              </div>
            </div>

            {textoLivre ? (
              <Textarea
                rows={10}
                value={textoReceita}
                onChange={(e) => setTextoReceita(e.target.value)}
                placeholder={'1. Medicamento — quantidade\n   Posologia…'}
                aria-label="Texto da receita"
              />
            ) : (
              <div className="space-y-3">
                {itens.map((item, i) => (
                  <div key={i} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 w-5 text-sm font-medium text-muted-foreground tabular-nums">{i + 1}.</span>
                      <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_12rem]">
                        <Input
                          value={item.medicamento}
                          onChange={(e) => setItens((l) => l.map((x, j) => (j === i ? { ...x, medicamento: e.target.value } : x)))}
                          placeholder="Medicamento e concentração (ex.: Amoxicilina 500 mg)"
                          aria-label={`Medicamento ${i + 1}`}
                          maxLength={200}
                        />
                        <Input
                          value={item.quantidade ?? ''}
                          onChange={(e) => setItens((l) => l.map((x, j) => (j === i ? { ...x, quantidade: e.target.value } : x)))}
                          placeholder="Quantidade (ex.: 1 caixa)"
                          aria-label={`Quantidade ${i + 1}`}
                          maxLength={100}
                        />
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setItens((l) => (l.length > 1 ? l.filter((_, j) => j !== i) : [itemVazio()]))}
                        aria-label={`Remover medicamento ${i + 1}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <Textarea
                      rows={2}
                      className="ml-7 w-[calc(100%-4.75rem)]"
                      value={item.posologia ?? ''}
                      onChange={(e) => setItens((l) => l.map((x, j) => (j === i ? { ...x, posologia: e.target.value } : x)))}
                      placeholder="Posologia (ex.: tomar 1 cápsula de 8 em 8 horas por 7 dias)"
                      aria-label={`Posologia ${i + 1}`}
                    />
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={() => setItens((l) => [...l, itemVazio()])} disabled={itens.length >= 50}>
                  <Plus /> Adicionar medicamento
                </Button>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-orientacoes">Orientações (opcional)</Label>
                  <Textarea id="doc-orientacoes" rows={3} value={orientacoes} onChange={(e) => setOrientacoes(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {tipo === 'atestado' && (
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <div className="space-y-1.5">
              <Label htmlFor="doc-dias">Dias de afastamento</Label>
              <Input id="doc-dias" inputMode="numeric" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder="Opcional" />
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2 pt-6">
                <Checkbox id="doc-autorizou-cid" checked={autorizouCid} onCheckedChange={(v) => setAutorizouCid(v === true)} />
                <Label htmlFor="doc-autorizou-cid" className="text-sm leading-snug font-normal">
                  O paciente autorizou incluir o CID no atestado
                </Label>
              </div>
              {autorizouCid && (
                <Input value={cid} onChange={(e) => setCid(e.target.value.toUpperCase())} placeholder="CID-10 (ex.: J11)" className="sm:w-48" maxLength={6} aria-label="CID-10" />
              )}
            </div>
          </div>
        )}

        {tipo === 'declaracao' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-data">Data</Label>
              <Input id="doc-data" type="date" value={dataDecl} onChange={(e) => setDataDecl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-hora-inicio">Chegada</Label>
              <Input id="doc-hora-inicio" type="time" value={horaInicio} onChange={(e) => setHoraInicio(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-hora-fim">Saída</Label>
              <Input id="doc-hora-fim" type="time" value={horaFim} onChange={(e) => setHoraFim(e.target.value)} />
            </div>
          </div>
        )}

        {(tipo === 'atestado' || tipo === 'declaracao') && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="doc-texto">Texto</Label>
              {textoEditado && (
                <Button variant="ghost" size="xs" onClick={() => setTextoEditado(false)}>
                  Restaurar modelo
                </Button>
              )}
            </div>
            <Textarea
              id="doc-texto"
              rows={6}
              value={texto}
              onChange={(e) => {
                setTexto(e.target.value);
                setTextoEditado(true);
              }}
            />
          </div>
        )}

        {tipo === 'pedido_exame' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="doc-exames">Exames (um por linha)</Label>
              <Textarea
                id="doc-exames"
                rows={6}
                value={exames}
                onChange={(e) => setExames(e.target.value)}
                placeholder={'Hemograma completo\nGlicemia de jejum\nTSH e T4 livre'}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-indicacao">Indicação clínica (opcional)</Label>
              <Input id="doc-indicacao" value={indicacao} onChange={(e) => setIndicacao(e.target.value)} maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-obs-exame">Observações (opcional)</Label>
              <Textarea id="doc-obs-exame" rows={2} value={observacoesExame} onChange={(e) => setObservacoesExame(e.target.value)} />
            </div>
          </div>
        )}
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onFechar}>
          Cancelar
        </Button>
        <Button onClick={preVisualizar} disabled={gerandoPrevia}>
          {gerandoPrevia ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          Pré-visualizar
        </Button>
      </DialogFooter>
      <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <FileText className="size-3.5" /> Na próxima etapa você confere o PDF antes de emitir.
      </p>
    </>
  );
}
