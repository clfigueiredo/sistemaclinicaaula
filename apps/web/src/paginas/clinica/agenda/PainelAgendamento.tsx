// Painel lateral com os detalhes do agendamento e as ações de status.
// Fase 2: blocos de outros módulos (cada um é do seu dono — docs/FASE2.md), exibidos conforme status/papel/plano:
//   <RecebimentoConsulta />   financeiro      — não cancelado; admin/recepção; recurso `financeiro`
//   <DefinirRetorno />        retornos        — compareceu/atendido; recurso `retorno_automatico`
//   <SugestoesListaEspera />  lista-espera    — cancelado/faltou; admin/recepção; recurso `lista_espera`
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  CalendarClock,
  CheckCircle2,
  CircleCheckBig,
  ExternalLink,
  Loader2,
  Pencil,
  Phone,
  Stethoscope,
  UserCheck,
  UserX,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/api/cliente';
import {
  STATUS_REMARCAVEIS,
  TRANSICOES_STATUS,
  useMudarStatusAgendamento,
  type Agendamento,
} from '@/api/agendamentos';
import { ROTULOS_STATUS_AGENDAMENTO, type StatusAgendamento } from '@/api/tipos';
import { useMe } from '@/api/me';
import { PAPEIS_ROTA, recursoHabilitado } from '@/rotas/navegacao';
import { Button } from '@/componentes/ui/button';
import { Label } from '@/componentes/ui/label';
import { Separator } from '@/componentes/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/componentes/ui/sheet';
import { Textarea } from '@/componentes/ui/textarea';
import { mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { ESTILO_STATUS } from './utilidades';
import { DefinirRetorno } from './DefinirRetorno';
import { RecebimentoConsulta } from './RecebimentoConsulta';
import { SugestoesListaEspera } from './SugestoesListaEspera';

const ACOES: Record<
  Exclude<StatusAgendamento, 'agendado'>,
  { rotulo: string; icone: LucideIcon; variante: 'default' | 'outline' | 'destructive' }
> = {
  confirmado: { rotulo: 'Confirmar', icone: CheckCircle2, variante: 'default' },
  compareceu: { rotulo: 'Compareceu', icone: UserCheck, variante: 'default' },
  atendido: { rotulo: 'Atendido', icone: CircleCheckBig, variante: 'default' },
  faltou: { rotulo: 'Faltou', icone: UserX, variante: 'outline' },
  cancelado: { rotulo: 'Cancelar', icone: XCircle, variante: 'destructive' },
};

export function BadgeStatus({ status }: { status: StatusAgendamento }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      <span className={cn('size-2 rounded-full', ESTILO_STATUS[status].ponto)} />
      {ROTULOS_STATUS_AGENDAMENTO[status]}
    </span>
  );
}

export function PainelAgendamento({
  agendamento,
  onOpenChange,
  onEditar,
  podeAlterar,
}: {
  agendamento: Agendamento | null;
  onOpenChange: (aberto: boolean) => void;
  onEditar: (a: Agendamento) => void;
  podeAlterar: boolean;
}) {
  const mudar = useMudarStatusAgendamento();
  const { data: me } = useMe();
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState('');

  useEffect(() => {
    setCancelando(false);
    setMotivo('');
  }, [agendamento?.id]);

  const a = agendamento;
  const aberto = !!a;

  async function aplicar(status: StatusAgendamento) {
    if (!a) return;
    try {
      await mudar.mutateAsync({ id: a.id, status, motivo: status === 'cancelado' ? motivo.trim() || undefined : undefined });
      toast.success(`Status alterado para "${ROTULOS_STATUS_AGENDAMENTO[status]}".`);
      setCancelando(false);
      setMotivo('');
    } catch (e) {
      if ((e as { codigo?: string }).codigo !== 'assinatura_inativa') toast.error(mensagemDeErro(e));
    }
  }

  const proximos = a ? TRANSICOES_STATUS[a.status] : [];
  const equipe = !!me && (me.papel === 'admin' || me.papel === 'recepcao');
  const mostrarRecebimento =
    !!a &&
    a.status !== 'cancelado' &&
    !!me &&
    PAPEIS_ROTA.recebimentoConsulta.includes(me.papel) &&
    recursoHabilitado(me, 'financeiro');
  const mostrarRetorno =
    !!a && (a.status === 'compareceu' || a.status === 'atendido') && recursoHabilitado(me, 'retorno_automatico');
  const mostrarListaEspera =
    !!a && (a.status === 'cancelado' || a.status === 'faltou') && equipe && recursoHabilitado(me, 'lista_espera');

  return (
    <Sheet open={aberto} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {a && (
          <>
            <SheetHeader>
              <SheetTitle className="pr-6">{a.paciente.nome}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <BadgeStatus status={a.status} />
                  <span className="text-xs">{a.tipo === 'convenio' ? `Convênio${a.convenio ? ` · ${a.convenio.nome}` : ''}` : 'Particular'}</span>
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-4 px-4 text-sm">
              <dl className="space-y-3">
                <div className="flex items-start gap-3">
                  <CalendarClock className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Data e horário</dt>
                    <dd className="first-letter:uppercase">
                      {format(new Date(a.inicio), "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
                    </dd>
                    <dd className="text-muted-foreground tabular-nums">
                      {format(new Date(a.inicio), 'HH:mm')} – {format(new Date(a.fim), 'HH:mm')}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Stethoscope className="mt-0.5 size-4 text-muted-foreground" />
                  <div>
                    <dt className="sr-only">Profissional</dt>
                    <dd className="flex items-center gap-2">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: a.profissional.cor_agenda }} />
                      {a.profissional.nome}
                    </dd>
                  </div>
                </div>
                {(a.paciente.telefone || a.paciente.whatsapp) && (
                  <div className="flex items-start gap-3">
                    <Phone className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <dt className="sr-only">Telefone</dt>
                      <dd>{mascararTelefone(a.paciente.telefone || (a.paciente.whatsapp ?? '').replace(/^55/, ''))}</dd>
                    </div>
                  </div>
                )}
              </dl>

              <Button asChild variant="outline" size="sm" className="w-full">
                <Link to={`/pacientes/${a.paciente.id}`}>
                  <ExternalLink className="size-4" /> Abrir ficha do paciente
                </Link>
              </Button>

              {a.status === 'cancelado' && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                  <p className="mb-1 text-xs font-medium text-destructive">
                    Cancelado
                    {a.cancelado_em && ` em ${format(new Date(a.cancelado_em), "dd/MM/yyyy 'às' HH:mm")}`}
                  </p>
                  <p className="whitespace-pre-wrap">{a.motivo_cancelamento || 'Motivo não informado.'}</p>
                </div>
              )}

              {a.observacoes && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Observações</p>
                  <p className="rounded-md bg-muted/60 p-3 whitespace-pre-wrap">{a.observacoes}</p>
                </div>
              )}

              {a && mostrarRecebimento && <RecebimentoConsulta agendamento={a} />}
              {a && mostrarRetorno && <DefinirRetorno agendamento={a} podeAlterar={podeAlterar} />}
              {a && mostrarListaEspera && <SugestoesListaEspera agendamento={a} />}

              {podeAlterar && proximos.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Alterar status</p>
                    {cancelando ? (
                      <div className="space-y-2 rounded-md border border-destructive/30 p-3">
                        <Label htmlFor="motivo-cancelamento">Motivo do cancelamento</Label>
                        <Textarea
                          id="motivo-cancelamento"
                          rows={2}
                          autoFocus
                          maxLength={500}
                          placeholder="Opcional — ex.: paciente pediu para remarcar"
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                        />
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setCancelando(false)}>
                            Voltar
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={mudar.isPending}
                            onClick={() => aplicar('cancelado')}
                          >
                            {mudar.isPending && <Loader2 className="size-4 animate-spin" />}
                            Confirmar cancelamento
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {proximos.map((s) => {
                          const acao = ACOES[s as Exclude<StatusAgendamento, 'agendado'>];
                          const Icone = acao.icone;
                          return (
                            <Button
                              key={s}
                              size="sm"
                              variant={acao.variante}
                              disabled={mudar.isPending}
                              onClick={() => (s === 'cancelado' ? setCancelando(true) : aplicar(s))}
                            >
                              <Icone className="size-4" />
                              {acao.rotulo}
                            </Button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {podeAlterar && a.status !== 'cancelado' && (
              <SheetFooter>
                <Button variant="outline" onClick={() => onEditar(a)}>
                  <Pencil className="size-4" />
                  {STATUS_REMARCAVEIS.includes(a.status) ? 'Editar / remarcar' : 'Editar observações'}
                </Button>
              </SheetFooter>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
