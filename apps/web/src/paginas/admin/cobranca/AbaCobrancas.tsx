/**
 * Lista de cobranças de todas as clínicas (página /admin/cobrancas): filtros rápidos por situação (a vencer, em
 * atraso, inadimplentes, pagas, canceladas), clínica e período, totais, gerar cobrança avulsa, ligar/desligar a
 * cobrança automática, baixa manual, cancelar, abrir/copiar/reenviar link. Mostra quando cada clínica perde o
 * acesso (`bloqueia_em`) e a situação atual do acesso.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  AlertCircle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Receipt,
  Repeat,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useAtivarCobrancaClinica,
  useCancelarCobranca,
  useCobrancaClinica,
  useCobrancas,
  useCriarCobranca,
  useDesativarCobrancaClinica,
  useGatewaysPagamento,
  usePagarManual,
  type CobrancaAdmin,
  type FiltrosCobrancas,
  type SituacaoCobranca,
} from '@/api/adminCobranca';
import { useListaClinicasAdmin } from '@/api/adminClinicas';
import { mensagemDeErro } from '@/api/cliente';
import {
  ROTULOS_METODO_COBRANCA,
  ROTULOS_PROVEDOR_PAGAMENTO,
  type MetodoCobranca,
} from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BadgeStatusAssinatura, CardKpi, DialogoConfirmacao, ErroCarregar } from '../comum';
import { BadgeStatusCobranca, copiarTexto, dataIsoMaisDias, Paginacao } from './comum';

const POR_PAGINA = 20;
const TODOS = 'todos';
const SEM_METODO = 'qualquer';

const SITUACOES: { valor: SituacaoCobranca | ''; rotulo: string; dica: string }[] = [
  { valor: '', rotulo: 'Todas', dica: 'Todas as cobranças' },
  { valor: 'a_vencer', rotulo: 'A vencer (7 dias)', dica: 'Pendentes com vencimento nos próximos 7 dias' },
  { valor: 'em_atraso', rotulo: 'Em atraso', dica: 'Venceram, mas a clínica ainda tem acesso (dentro da tolerância)' },
  { valor: 'inadimplente', rotulo: 'Inadimplentes', dica: 'Em dívida e com o acesso da clínica já suspenso' },
  { valor: 'paga', rotulo: 'Pagas', dica: 'Pagamento confirmado' },
  { valor: 'cancelada', rotulo: 'Canceladas/estornadas', dica: 'Canceladas, estornadas ou com chargeback' },
];

function hojeIso() {
  return dataIsoMaisDias(0);
}

/** "bloqueia em 3 dias" / "bloqueia hoje" / "sem acesso desde dd/mm" — situação do acesso pela cobrança. */
function AvisoBloqueio({ c }: { c: CobrancaAdmin }) {
  if (c.contratacao && (c.status === 'pendente' || c.status === 'vencida')) {
    return <p className="text-xs text-muted-foreground">contratação: libera o plano ao pagar</p>;
  }
  if (!c.bloqueia_em) return null;
  const suspensa = c.acesso && ['vencida', 'cancelada', 'bloqueada'].includes(c.acesso.status);
  if (suspensa) return <p className="text-xs font-medium text-destructive">acesso suspenso</p>;
  const hoje = hojeIso();
  const dias = Math.round((Date.parse(c.bloqueia_em) - Date.parse(hoje)) / 86_400_000);
  if (c.vencimento >= hoje) return <p className="text-xs text-muted-foreground">bloqueia em {formatarData(c.bloqueia_em)} se não pagar</p>;
  return (
    <p className="text-xs font-medium text-warning">
      {dias <= 0 ? 'bloqueia hoje' : `bloqueia em ${dias} dia${dias > 1 ? 's' : ''} (${formatarData(c.bloqueia_em)})`}
    </p>
  );
}

export default function AbaCobrancas() {
  const [params, setParams] = useSearchParams();
  const situacao = (params.get('situacao') ?? '') as SituacaoCobranca | '';
  const clinicaId = params.get('clinica') ?? '';
  const de = params.get('de') ?? '';
  const ate = params.get('ate') ?? '';
  const pagina = Math.max(1, Number(params.get('pagina')) || 1);

  const [dialogo, setDialogo] = useState<'gerar' | 'automatica' | null>(null);
  const [cancelando, setCancelando] = useState<CobrancaAdmin | null>(null);
  const [baixando, setBaixando] = useState<CobrancaAdmin | null>(null);
  const cancelar = useCancelarCobranca();
  const clinicas = useListaClinicasAdmin({ porPagina: 100 });
  const gateways = useGatewaysPagamento();
  const gatewayAtivo = gateways.data?.find((g) => g.ativo) ?? null;

  function atualizar(novos: Record<string, string | number | undefined>) {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(novos)) {
      if (v === undefined || v === '' || v === TODOS) p.delete(k);
      else p.set(k, String(v));
    }
    if (!('pagina' in novos)) p.delete('pagina');
    setParams(p, { replace: true });
  }

  const filtros: FiltrosCobrancas = {
    situacao: situacao || undefined,
    clinica_id: clinicaId || undefined,
    de: de || undefined,
    ate: ate || undefined,
    pagina,
    por_pagina: POR_PAGINA,
  };
  const { data, isLoading, isError, error, refetch } = useCobrancas(filtros);
  const temFiltro = !!(situacao || clinicaId || de || ate);

  function reenviar(c: CobrancaAdmin) {
    if (!c.link_pagamento) return;
    const assunto = encodeURIComponent(`Fatura do sistema — vencimento ${formatarData(c.vencimento)}`);
    const corpo = encodeURIComponent(
      `Olá, ${c.clinica.nome}!\n\nSegue o link para pagamento da fatura de ${formatarMoeda(c.valor)} com vencimento em ${formatarData(c.vencimento)}:\n${c.link_pagamento}\n\nObrigado!`,
    );
    window.location.href = `mailto:${c.clinica.email ?? ''}?subject=${assunto}&body=${corpo}`;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Situação da cobrança">
        {SITUACOES.map((st) => (
          <Button
            key={st.valor || 'todas'}
            size="sm"
            variant={situacao === st.valor ? 'default' : 'outline'}
            title={st.dica}
            aria-pressed={situacao === st.valor}
            onClick={() => atualizar({ situacao: st.valor })}
          >
            {st.rotulo}
          </Button>
        ))}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Clínica</Label>
            <Select value={clinicaId || TODOS} onValueChange={(v) => atualizar({ clinica: v })}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Clínica">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={TODOS}>Todas as clínicas</SelectItem>
                {clinicas.data?.itens.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="filtro-de" className="text-xs text-muted-foreground">
              Vencimento de
            </Label>
            <Input id="filtro-de" type="date" value={de} onChange={(e) => atualizar({ de: e.target.value })} className="sm:w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="filtro-ate" className="text-xs text-muted-foreground">
              até
            </Label>
            <Input id="filtro-ate" type="date" value={ate} onChange={(e) => atualizar({ ate: e.target.value })} className="sm:w-40" />
          </div>
          {temFiltro && (
            <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              <X /> Limpar
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setDialogo('automatica')}>
            <Repeat /> Cobrança automática
          </Button>
          <Button onClick={() => setDialogo('gerar')}>
            <Plus /> Gerar cobrança
          </Button>
        </div>
      </div>

      {gateways.data && !gatewayAtivo && (
        <Alert>
          <AlertCircle />
          <AlertDescription>
            <p>Nenhum gateway ativo: não é possível gerar cobranças. Ative um em <strong>Gateways</strong>, no menu.</p>
          </AlertDescription>
        </Alert>
      )}

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CardKpi
            titulo="Recebido"
            valor={formatarMoeda(data.totais.recebido)}
            detalhe={`${data.totais.quantidade.paga} paga(s)`}
            icone={<CheckCircle2 className="size-5" />}
            destaque="sucesso"
          />
          <CardKpi
            titulo="A vencer (7 dias)"
            valor={formatarMoeda(data.totais.a_vencer)}
            detalhe={`${data.totais.quantidade.a_vencer} cobrança(s)`}
            icone={<CalendarClock className="size-5" />}
          />
          <CardKpi
            titulo="Pendente"
            valor={formatarMoeda(data.totais.pendente)}
            detalhe={`${data.totais.quantidade.pendente} em aberto`}
            icone={<Clock className="size-5" />}
          />
          <CardKpi
            titulo="Vencido"
            valor={formatarMoeda(data.totais.vencido)}
            detalhe={`${data.totais.quantidade.vencida} vencida(s)`}
            icone={<AlertCircle className="size-5" />}
            destaque="alerta"
          />
        </div>
      )}

      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : data.itens.length === 0 ? (
        <EstadoVazio
          icone={<Receipt className="size-5" />}
          titulo={temFiltro ? 'Nenhuma cobrança encontrada' : 'Nenhuma cobrança ainda'}
          descricao={
            temFiltro
              ? 'Tente outros filtros.'
              : 'Gere uma cobrança avulsa ou ligue a cobrança automática de uma clínica com plano pago.'
          }
        />
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Clínica</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Acesso da clínica</TableHead>
                  <TableHead className="hidden md:table-cell">Gateway</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itens.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-72 pl-4">
                      <p className="truncate font-medium">{c.clinica.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.contratacao && (
                          <Badge variant="outline" className="mr-1 px-1.5 py-0 text-[10px]">
                            Contratação{c.plano_contratado_nome ? `: ${c.plano_contratado_nome}` : ''}
                          </Badge>
                        )}
                        {c.descricao ?? '—'}
                      </p>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatarData(c.vencimento)}
                      {c.pago_em && <p className="text-xs text-muted-foreground">pago em {formatarData(c.pago_em)}</p>}
                      <AvisoBloqueio c={c} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatarMoeda(c.valor)}</TableCell>
                    <TableCell>
                      <BadgeStatusCobranca status={c.status} />
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {c.acesso ? (
                        <div className="space-y-0.5">
                          <BadgeStatusAssinatura status={c.acesso.status} />
                          <p className="text-xs text-muted-foreground">{c.acesso.plano}</p>
                        </div>
                      ) : (
                        <BadgeStatusAssinatura status={null} />
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {ROTULOS_PROVEDOR_PAGAMENTO[c.gateway]}
                      {c.metodo && ` · ${ROTULOS_METODO_COBRANCA[c.metodo]}`}
                    </TableCell>
                    <TableCell className="pr-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label="Ações da cobrança">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!c.link_pagamento} asChild={!!c.link_pagamento}>
                            {c.link_pagamento ? (
                              <a href={c.link_pagamento} target="_blank" rel="noopener noreferrer">
                                <ExternalLink /> Abrir link de pagamento
                              </a>
                            ) : (
                              <span>
                                <ExternalLink /> Sem link de pagamento
                              </span>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!c.link_pagamento}
                            onSelect={() => c.link_pagamento && copiarTexto(c.link_pagamento, 'Link de pagamento copiado.')}
                          >
                            <Copy /> Copiar link
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!c.link_pagamento || !['pendente', 'vencida'].includes(c.status)}
                            onSelect={() => reenviar(c)}
                          >
                            <Mail /> Reenviar link por e-mail
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!['pendente', 'vencida'].includes(c.status)}
                            onSelect={() => setBaixando(c)}
                          >
                            <CircleDollarSign /> Dar baixa manual
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!['pendente', 'vencida', 'estornada'].includes(c.status)}
                            onSelect={() => setCancelando(c)}
                          >
                            <Ban /> Cancelar cobrança
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao
            pagina={pagina}
            total={data.total}
            porPagina={POR_PAGINA}
            rotulo={['cobrança', 'cobranças']}
            aoMudar={(p) => atualizar({ pagina: p })}
          />
        </>
      )}

      {dialogo === 'gerar' && (
        <DialogoGerarCobranca
          clinicaInicial={clinicaId}
          metodos={gatewayAtivo?.metodos ?? []}
          nomeGateway={gatewayAtivo?.nome ?? null}
          aoFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'automatica' && (
        <DialogoCobrancaAutomatica
          clinicaInicial={clinicaId}
          diaPadrao={gatewayAtivo?.dia_vencimento_padrao ?? 10}
          metodos={gatewayAtivo?.metodos ?? []}
          nomeGateway={gatewayAtivo?.nome ?? null}
          aoFechar={() => setDialogo(null)}
        />
      )}

      {baixando && <DialogoBaixaManual cobranca={baixando} aoFechar={() => setBaixando(null)} />}

      <DialogoConfirmacao
        aberto={!!cancelando}
        aoMudar={(v) => !v && setCancelando(null)}
        titulo="Cancelar cobrança?"
        descricao={
          cancelando?.status === 'estornada'
            ? `A cobrança estornada de ${formatarMoeda(cancelando.valor)} de ${cancelando.clinica.nome} deixa de contar como dívida (perdão do estorno/chargeback). Nada é enviado ao gateway.`
            : cancelando
            ? `A cobrança de ${formatarMoeda(cancelando.valor)} de ${cancelando.clinica.nome} (vencimento ${formatarData(cancelando.vencimento)}) será cancelada também no ${ROTULOS_PROVEDOR_PAGAMENTO[cancelando.gateway]}. O link deixa de funcionar e a cobrança automática não gera outra para o mesmo mês.`
            : undefined
        }
        perigo
        textoConfirmar="Cancelar cobrança"
        carregando={cancelar.isPending}
        aoConfirmar={() =>
          cancelando &&
          cancelar.mutate(cancelando.id, {
            onSuccess: () => {
              toast.success('Cobrança cancelada.');
              setCancelando(null);
            },
            onError: (e) => toast.error(mensagemDeErro(e)),
          })
        }
      />
    </div>
  );
}

// ----------------------------------------------------------------------------- seletor de clínica

function SeletorClinica({ valor, aoMudar }: { valor: string; aoMudar: (id: string) => void }) {
  const clinicas = useListaClinicasAdmin({ porPagina: 100 });
  return (
    <Select value={valor} onValueChange={aoMudar} disabled={clinicas.isLoading}>
      <SelectTrigger className="w-full" aria-label="Clínica">
        <SelectValue placeholder={clinicas.isLoading ? 'Carregando…' : 'Selecione a clínica'} />
      </SelectTrigger>
      <SelectContent>
        {clinicas.data?.itens.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.nome}
            {c.assinatura && ` — ${c.assinatura.plano.nome} (${formatarMoeda(c.assinatura.plano.preco)})`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ----------------------------------------------------------------------------- gerar cobrança

const esquemaGerar = z.object({
  clinica_id: z.string().min(1, 'Selecione a clínica'),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe o vencimento'),
  valor: z
    .string()
    .trim()
    .refine((v) => !v || (Number(v.replace(',', '.')) > 0 && Number.isFinite(Number(v.replace(',', '.')))), 'Valor inválido'),
  descricao: z.string().trim().max(200, 'Máximo de 200 caracteres'),
  metodo: z.string(),
});
type CamposGerar = z.infer<typeof esquemaGerar>;

export function DialogoGerarCobranca({
  clinicaInicial,
  metodos,
  nomeGateway,
  aoFechar,
  fixarClinica = false,
}: {
  clinicaInicial: string;
  metodos: MetodoCobranca[];
  nomeGateway: string | null;
  aoFechar: () => void;
  /** Esconde o seletor de clínica (aberto a partir do detalhe da clínica). */
  fixarClinica?: boolean;
}) {
  const criar = useCriarCobranca();
  const form = useForm<CamposGerar>({
    resolver: zodResolver(esquemaGerar),
    defaultValues: { clinica_id: clinicaInicial, vencimento: dataIsoMaisDias(3), valor: '', descricao: '', metodo: SEM_METODO },
  });

  function salvar(v: CamposGerar) {
    criar.mutate(
      {
        clinicaId: v.clinica_id,
        vencimento: v.vencimento,
        ...(v.valor && { valor: Number(v.valor.replace(',', '.')) }),
        ...(v.descricao && { descricao: v.descricao }),
        ...(v.metodo !== SEM_METODO && { metodo: v.metodo as MetodoCobranca }),
      },
      {
        onSuccess: (c) => {
          toast.success('Cobrança gerada.', {
            description: c.link_pagamento ? 'Link de pagamento disponível no menu da cobrança.' : undefined,
          });
          aoFechar();
        },
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !criar.isPending && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerar cobrança</DialogTitle>
          <DialogDescription>
            {nomeGateway
              ? `Cobrança avulsa emitida no ${nomeGateway} (gateway ativo).`
              : 'Nenhum gateway ativo — ative um em Gateways (menu) antes de gerar.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(salvar)} className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="clinica_id"
              render={({ field }) => (
                <FormItem className={cn('sm:col-span-2', fixarClinica && 'hidden')}>
                  <FormLabel>Clínica</FormLabel>
                  <SeletorClinica valor={field.value} aoMudar={field.onChange} />
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="vencimento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vencimento</FormLabel>
                  <FormControl>
                    <Input type="date" min={dataIsoMaisDias(0)} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="valor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Valor (R$)</FormLabel>
                  <FormControl>
                    <Input inputMode="decimal" placeholder="Preço do plano" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="metodo"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Método</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={SEM_METODO}>Cliente escolhe (métodos permitidos no gateway)</SelectItem>
                      {metodos.map((m) => (
                        <SelectItem key={m} value={m}>
                          {ROTULOS_METODO_COBRANCA[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descricao"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Descrição (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Padrão: texto configurado no gateway" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={aoFechar} disabled={criar.isPending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={criar.isPending || !nomeGateway}>
                {criar.isPending && <Loader2 className="animate-spin" />}
                Gerar cobrança
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- cobrança automática

export function DialogoCobrancaAutomatica({
  clinicaInicial,
  diaPadrao,
  metodos,
  nomeGateway,
  aoFechar,
  fixarClinica = false,
}: {
  clinicaInicial: string;
  diaPadrao: number;
  metodos: MetodoCobranca[];
  nomeGateway: string | null;
  aoFechar: () => void;
  /** Esconde o seletor de clínica (aberto a partir do detalhe da clínica). */
  fixarClinica?: boolean;
}) {
  const [clinicaId, setClinicaId] = useState(clinicaInicial);
  const [dia, setDia] = useState<string | null>(null);
  const [metodo, setMetodo] = useState<string | null>(null);
  const [gerarAgora, setGerarAgora] = useState(true);
  const detalhe = useCobrancaClinica(clinicaId || undefined);
  const ativar = useAtivarCobrancaClinica();
  const desativar = useDesativarCobrancaClinica();
  const assinatura = detalhe.data?.assinatura ?? null;
  // Padrões: o que a assinatura já tem (ao "Atualizar") ou o do gateway.
  const diaAtual = dia ?? String(assinatura?.dia_vencimento ?? diaPadrao);
  const metodoAtual = metodo ?? assinatura?.metodo_cobranca ?? SEM_METODO;
  const diaValido = /^\d+$/.test(diaAtual) && Number(diaAtual) >= 1 && Number(diaAtual) <= 28;
  const planoPago = assinatura ? Number(assinatura.plano.preco) > 0 : false;
  const ocupado = ativar.isPending || desativar.isPending;

  function ligar() {
    ativar.mutate(
      {
        clinicaId,
        dia_vencimento: Number(diaAtual),
        gerar_agora: gerarAgora,
        ...(metodoAtual !== SEM_METODO && { metodo: metodoAtual as MetodoCobranca }),
      },
      {
        onSuccess: (r) => {
          toast.success('Cobrança automática ligada.', {
            description: r.cobranca
              ? `Primeira cobrança gerada com vencimento em ${formatarData(r.cobranca.vencimento)}.`
              : 'As cobranças serão geradas até 10 dias antes de cada vencimento.',
          });
          aoFechar();
        },
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  function desligar() {
    desativar.mutate(clinicaId, {
      onSuccess: () => {
        toast.success('Cobrança automática desligada. As cobranças já emitidas continuam valendo.');
        aoFechar();
      },
      onError: (e) => toast.error(mensagemDeErro(e)),
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !ocupado && aoFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cobrança automática</DialogTitle>
          <DialogDescription>
            Todo mês o sistema gera a cobrança da mensalidade no gateway ativo{nomeGateway ? ` (${nomeGateway})` : ''}, até 10
            dias antes do vencimento. Sem pagamento após a tolerância, a assinatura fica vencida (acesso suspenso) e volta a
            ativa quando o pagamento é confirmado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!fixarClinica && (
            <div className="space-y-2">
              <Label>Clínica</Label>
              <SeletorClinica valor={clinicaId} aoMudar={setClinicaId} />
            </div>
          )}

          {clinicaId && detalhe.isLoading && <Carregando texto="Carregando assinatura…" />}
          {clinicaId && detalhe.isError && <p className="text-sm text-destructive">{mensagemDeErro(detalhe.error)}</p>}
          {clinicaId && detalhe.data && !assinatura && (
            <p className="text-sm text-muted-foreground">Esta clínica não tem assinatura. Atribua um plano em Clínicas.</p>
          )}
          {assinatura && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">
                  {assinatura.plano.nome} · {formatarMoeda(assinatura.plano.preco)}/mês
                </span>
                <BadgeStatusAssinatura status={assinatura.status} />
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                <CalendarClock className="size-4" />
                {assinatura.cobranca_automatica
                  ? `Ligada: vence todo dia ${assinatura.dia_vencimento} (${assinatura.gateway ? ROTULOS_PROVEDOR_PAGAMENTO[assinatura.gateway] : '—'}${assinatura.metodo_cobranca ? ` · ${ROTULOS_METODO_COBRANCA[assinatura.metodo_cobranca]}` : ''}).`
                  : 'Cobrança automática desligada.'}
              </p>
              {!planoPago && <p className="mt-1 text-amber-700 dark:text-amber-300">Plano gratuito: não há o que cobrar.</p>}
            </div>
          )}

          {assinatura && planoPago && (
            <>
              <div className="space-y-2">
                <Label htmlFor="dia-vencimento">Dia do vencimento (1 a 28)</Label>
                <Input
                  id="dia-vencimento"
                  type="number"
                  min={1}
                  max={28}
                  inputMode="numeric"
                  value={diaAtual}
                  onChange={(e) => setDia(e.target.value)}
                  className="w-32"
                  aria-invalid={!diaValido}
                />
                {!diaValido && <p className="text-sm text-destructive">Informe um dia entre 1 e 28.</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="metodo-preferido">Método preferido</Label>
                <Select value={metodoAtual} onValueChange={setMetodo}>
                  <SelectTrigger id="metodo-preferido" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_METODO}>Cliente escolhe (métodos permitidos no gateway)</SelectItem>
                    {metodos.map((m) => (
                      <SelectItem key={m} value={m}>
                        {ROTULOS_METODO_COBRANCA[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={gerarAgora} onCheckedChange={(c) => setGerarAgora(c === true)} className="mt-0.5" />
                <span>
                  Gerar agora a cobrança do próximo vencimento
                  <span className="block text-xs text-muted-foreground">Se já existir cobrança nesse mês, nenhuma outra é criada.</span>
                </span>
              </label>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          {assinatura?.cobranca_automatica && (
            <Button variant="outline" className="text-destructive sm:mr-auto" onClick={desligar} disabled={ocupado}>
              {desativar.isPending && <Loader2 className="animate-spin" />}
              Desligar
            </Button>
          )}
          <Button variant="outline" onClick={aoFechar} disabled={ocupado}>
            Fechar
          </Button>
          <Button onClick={ligar} disabled={ocupado || !assinatura || !planoPago || !diaValido || !nomeGateway}>
            {ativar.isPending && <Loader2 className="animate-spin" />}
            {assinatura?.cobranca_automatica ? 'Atualizar' : 'Ligar cobrança automática'}
          </Button>
        </DialogFooter>
        {!nomeGateway && (
          <p className="text-xs text-muted-foreground">Ative um gateway em Gateways (menu) para ligar a cobrança automática.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Baixa manual: pagamento recebido fora do gateway (transferência, dinheiro…). */
function DialogoBaixaManual({ cobranca, aoFechar }: { cobranca: CobrancaAdmin; aoFechar: () => void }) {
  const pagar = usePagarManual();
  const [pagoEm, setPagoEm] = useState(hojeIso());
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(pagoEm) && pagoEm <= hojeIso();

  function confirmar() {
    pagar.mutate(
      { id: cobranca.id, pago_em: pagoEm },
      {
        onSuccess: (r) => {
          toast.success('Baixa registrada: cobrança marcada como paga.');
          if (r.aviso) toast.warning(r.aviso, { duration: 12_000 });
          aoFechar();
        },
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !pagar.isPending && aoFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dar baixa manual</DialogTitle>
          <DialogDescription>
            {cobranca.clinica.nome} · {formatarMoeda(cobranca.valor)} · vencimento {formatarData(cobranca.vencimento)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Use quando o pagamento foi recebido fora do {ROTULOS_PROVEDOR_PAGAMENTO[cobranca.gateway]} (transferência,
            dinheiro…). A cobrança fica paga, a clínica volta a ter acesso
            {cobranca.contratacao ? ' e o plano contratado é liberado' : ''}, e a cobrança é cancelada no gateway para não
            ser paga duas vezes.
          </p>
          <div className="space-y-1">
            <Label htmlFor="baixa-pago-em">Data do pagamento</Label>
            <Input
              id="baixa-pago-em"
              type="date"
              value={pagoEm}
              max={hojeIso()}
              onChange={(e) => setPagoEm(e.target.value)}
              className="sm:w-44"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={aoFechar} disabled={pagar.isPending}>
            Voltar
          </Button>
          <Button onClick={confirmar} disabled={!valido || pagar.isPending}>
            {pagar.isPending && <Loader2 className="animate-spin" />}
            Confirmar baixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
