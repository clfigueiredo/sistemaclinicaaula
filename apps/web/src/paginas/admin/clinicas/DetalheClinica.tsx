// Detalhe da clínica (super admin): dados, assinatura (plano/status/expiração), uso x limite dos
// recursos, usuários e ações (trocar plano, mudar status, definir expiração, ativar/desativar).
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  Lock,
  Power,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  useAlterarAssinatura,
  useAlterarSituacaoClinica,
  useClinicaAdmin,
  type DadosAssinatura,
  type DetalheClinicaAdmin,
} from '@/api/adminClinicas';
import { useListaPlanos } from '@/api/adminPlanos';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_PAPEL, ROTULOS_STATUS_ASSINATURA, type CodigoRecurso, type StatusAssinatura } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, formatarDataHora, formatarMoeda, mascararCpfCnpj, mascararTelefone } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { BadgeSituacao, BadgeStatusAssinatura, BarraUso, DialogoConfirmacao, ErroCarregar, textoUso } from '../comum';
import BlocoCobrancaClinica from '../cobranca/BlocoCobrancaClinica';

const DESCRICAO_STATUS: Record<StatusAssinatura, string> = {
  teste: 'Teste grátis: acesso completo dentro dos limites do plano.',
  ativa: 'Assinatura paga e em dia: acesso completo.',
  vencida: 'Pagamento em atraso: a clínica fica em modo somente leitura.',
  cancelada: 'Assinatura cancelada: a clínica fica em modo somente leitura.',
  bloqueada: 'Bloqueio administrativo: a clínica fica em modo somente leitura.',
};

const ROTULO_WHATSAPP: Record<string, string> = {
  desconectada: 'Desconectado',
  iniciando: 'Iniciando',
  aguardando_qr: 'Aguardando QR Code',
  conectada: 'Conectado',
  erro: 'Erro',
};

type Dialogo = 'plano' | 'status' | 'expiracao' | 'situacao' | null;

export default function PaginaDetalheClinica() {
  const { id } = useParams();
  const { data, isLoading, isError, error, refetch } = useClinicaAdmin(id);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/admin/clinicas">
          <ArrowLeft /> Clínicas
        </Link>
      </Button>
      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : (
        <Conteudo d={data} />
      )}
    </div>
  );
}

function Conteudo({ d }: { d: DetalheClinicaAdmin }) {
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const { clinica, assinatura, plano, recursos, usuarios, contadores, whatsapp } = d;
  const ativa = clinica.status === 'ativa';
  const limites = (Object.entries(recursos) as [CodigoRecurso, (typeof recursos)[CodigoRecurso]][]).filter(
    ([, r]) => r.tipo === 'limite',
  );
  const booleanos = (Object.entries(recursos) as [CodigoRecurso, (typeof recursos)[CodigoRecurso]][]).filter(
    ([, r]) => r.tipo === 'booleano',
  );
  const noLimite = limites.filter(([, r]) => r.habilitado && r.limite !== null && (r.uso ?? 0) >= r.limite).length;

  return (
    <div className="space-y-6">
      {/* Sem className="mb-0": no Tailwind 4 o space-y-6 usa margin-bottom e o mb-0 anulava o espaçamento. */}
      <CabecalhoPagina
        titulo={
          <span className="flex flex-wrap items-center gap-2">
            {clinica.nome}
            <BadgeSituacao ativa={ativa} rotuloAtivo="Clínica ativa" rotuloInativo="Clínica inativa" />
          </span>
        }
        descricao={`${mascararCpfCnpj(clinica.documento)} · cliente desde ${formatarData(clinica.criado_em)}`}
        acoes={
          <Button
            variant="outline"
            className={cn(ativa && 'text-destructive hover:text-destructive')}
            onClick={() => setDialogo('situacao')}
          >
            <Power /> {ativa ? 'Desativar clínica' : 'Reativar clínica'}
          </Button>
        }
      />

      {!ativa && (
        <Alert className="border-destructive/30 bg-destructive/5">
          <CircleSlash className="size-4 text-destructive" />
          <AlertTitle>Clínica inativa</AlertTitle>
          <AlertDescription>Nenhum usuário desta clínica consegue entrar no sistema enquanto ela estiver inativa.</AlertDescription>
        </Alert>
      )}
      {ativa && assinatura?.somente_leitura && (
        <Alert className="border-warning/40 bg-warning/10">
          <Lock className="size-4" />
          <AlertTitle>Modo somente leitura</AlertTitle>
          <AlertDescription>
            Com a assinatura {assinatura.status ? ROTULOS_STATUS_ASSINATURA[assinatura.status].toLowerCase() : 'inativa'}, a
            clínica consegue consultar os dados, mas não criar nem alterar nada.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Assinatura */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Assinatura</CardTitle>
            <CardDescription>Plano atual, status e validade</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {assinatura && plano ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <InfoAssinatura rotulo="Plano">
                  <Link to={`/admin/planos/${plano.id}`} className="font-medium hover:text-primary hover:underline">
                    {plano.nome}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {Number(plano.preco) > 0 ? `${formatarMoeda(plano.preco)}/mês` : 'Gratuito'}
                  </p>
                </InfoAssinatura>
                <InfoAssinatura rotulo="Status">
                  <BadgeStatusAssinatura status={assinatura.status} />
                  {assinatura.status !== assinatura.status_cadastrado && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Cadastrado como “{ROTULOS_STATUS_ASSINATURA[assinatura.status_cadastrado]}”, mas já expirou.
                    </p>
                  )}
                </InfoAssinatura>
                <InfoAssinatura rotulo="Validade">
                  <p className="font-medium">{assinatura.expira_em ? formatarData(assinatura.expira_em) : 'Sem expiração'}</p>
                  <p className="text-xs text-muted-foreground">Início em {formatarData(assinatura.inicio)}</p>
                </InfoAssinatura>
              </div>
            ) : (
              <Alert>
                <AlertTitle>Sem assinatura</AlertTitle>
                <AlertDescription>Esta clínica não tem assinatura. Atribua um plano para liberar o uso.</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button size="sm" onClick={() => setDialogo('plano')}>
                <ArrowRightLeft /> {assinatura ? 'Trocar plano' : 'Atribuir plano'}
              </Button>
              <Button size="sm" variant="outline" disabled={!assinatura} onClick={() => setDialogo('status')}>
                <ShieldCheck /> Mudar status
              </Button>
              <Button size="sm" variant="outline" disabled={!assinatura} onClick={() => setDialogo('expiracao')}>
                <CalendarClock /> Definir expiração
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Dados */}
        <Card>
          <CardHeader>
            <CardTitle>Dados da clínica</CardTitle>
            <CardDescription>Informações de cadastro</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2.5 text-sm">
              {[
                ['Responsável', clinica.responsavel],
                ['E-mail', clinica.email],
                ['Telefone', clinica.telefone ? mascararTelefone(clinica.telefone) : null],
                [
                  'Endereço',
                  [clinica.endereco, clinica.cidade && `${clinica.cidade}${clinica.uf ? `/${clinica.uf}` : ''}`, clinica.cep]
                    .filter(Boolean)
                    .join(' · ') || null,
                ],
                ['Fuso horário', clinica.fuso_horario],
                ['WhatsApp', whatsapp ? `${ROTULO_WHATSAPP[whatsapp.status] ?? whatsapp.status}${whatsapp.telefone ? ` · ${whatsapp.telefone}` : ''}` : 'Não configurado'],
              ].map(([rotulo, valor]) => (
                <div key={rotulo} className="grid grid-cols-5 gap-2">
                  <dt className="col-span-2 text-muted-foreground">{rotulo}</dt>
                  <dd className="col-span-3 break-words">{valor || '—'}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>

      {/* Uso x limite */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Uso dos recursos
            {noLimite > 0 && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/5 text-destructive">
                {noLimite} no limite
              </Badge>
            )}
          </CardTitle>
          <CardDescription>Consumo atual comparado aos limites do plano {plano?.nome ?? ''}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {limites.map(([codigo, r]) => {
              const cheio = r.habilitado && r.limite !== null && (r.uso ?? 0) >= r.limite;
              return (
                <div
                  key={codigo}
                  className={cn(
                    'rounded-lg border p-4',
                    !r.habilitado && 'bg-muted/40',
                    cheio && 'border-destructive/40 bg-destructive/5',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={cn('text-sm font-medium', !r.habilitado && 'text-muted-foreground')}>{r.nome}</p>
                    {r.periodo === 'mensal' && r.habilitado && (
                      <Badge variant="secondary" className="font-normal">
                        mensal
                      </Badge>
                    )}
                  </div>
                  {r.habilitado ? (
                    <>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">
                        {r.uso ?? 0}
                        <span className="text-sm font-normal text-muted-foreground">
                          {r.limite === null ? ' · ilimitado' : ` / ${r.limite}`}
                        </span>
                      </p>
                      <BarraUso className="mt-2" uso={r.uso ?? 0} limite={r.limite} />
                      <p className={cn('mt-1.5 text-xs', cheio ? 'text-destructive' : 'text-muted-foreground')}>
                        {cheio ? 'Limite atingido' : textoUso(r.uso, r.limite, r.periodo)}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">Não incluso no plano</p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            {booleanos.map(([codigo, r]) => (
              <Badge
                key={codigo}
                variant="outline"
                className={cn(r.habilitado ? 'border-success/30 bg-success/10 text-success' : 'text-muted-foreground')}
              >
                {r.habilitado ? <CheckCircle2 /> : <CircleSlash />}
                {r.nome}
              </Badge>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-4">
            {[
              ['Pacientes', contadores.pacientes],
              ['Agendamentos (total)', contadores.agendamentos],
              ['Profissionais (total)', contadores.profissionais],
              ['Registros de prontuário', contadores.registros_prontuario],
            ].map(([rotulo, valor]) => (
              <div key={rotulo}>
                <p className="text-muted-foreground">{rotulo}</p>
                <p className="text-lg font-semibold tabular-nums">{valor}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cobrança do SaaS (admin-cobranca) */}
      <BlocoCobrancaClinica clinicaId={clinica.id} />

      {/* Usuários */}
      <Card className="pb-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" /> Usuários
          </CardTitle>
          <CardDescription>{usuarios.length} usuário(s) com acesso a esta clínica</CardDescription>
        </CardHeader>
        {usuarios.length === 0 ? (
          <CardContent className="pb-6">
            <EstadoVazio titulo="Nenhum usuário" />
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Nome</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead className="hidden md:table-cell">Último acesso</TableHead>
                <TableHead className="pr-6">Situação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-6">
                    <p className="font-medium">{u.nome}</p>
                    <p className="text-xs text-muted-foreground">{u.email}</p>
                  </TableCell>
                  <TableCell>{ROTULOS_PAPEL[u.papel]}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {u.ultimo_acesso_em ? formatarDataHora(u.ultimo_acesso_em) : 'Nunca acessou'}
                  </TableCell>
                  <TableCell className="pr-6">
                    <BadgeSituacao ativa={u.ativo} rotuloAtivo="Ativo" rotuloInativo="Inativo" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <DialogoTrocarPlano key={`plano-${dialogo === 'plano'}`} d={d} aberto={dialogo === 'plano'} aoFechar={() => setDialogo(null)} />
      <DialogoStatus key={`status-${dialogo === 'status'}`} d={d} aberto={dialogo === 'status'} aoFechar={() => setDialogo(null)} />
      <DialogoExpiracao key={`expiracao-${dialogo === 'expiracao'}`} d={d} aberto={dialogo === 'expiracao'} aoFechar={() => setDialogo(null)} />
      <DialogoSituacao key={`situacao-${dialogo === 'situacao'}`} d={d} aberto={dialogo === 'situacao'} aoFechar={() => setDialogo(null)} />
    </div>
  );
}

function InfoAssinatura({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="mb-1 text-xs text-muted-foreground">{rotulo}</p>
      {children}
    </div>
  );
}

type PropsDialogo = { d: DetalheClinicaAdmin; aberto: boolean; aoFechar: () => void };

function useSalvarAssinatura(d: DetalheClinicaAdmin, aoFechar: () => void) {
  const alterar = useAlterarAssinatura(d.clinica.id);
  async function salvar(dados: DadosAssinatura, sucesso: string) {
    try {
      const r = await alterar.mutateAsync(dados);
      toast.success(sucesso);
      // Plano pago com gateway ativo: a API tenta ligar a cobrança automática.
      if (r.cobranca_automatica) {
        if (r.cobranca_automatica.ativada) toast.success(r.cobranca_automatica.mensagem);
        else toast.warning(r.cobranca_automatica.mensagem);
      }
      aoFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }
  return { salvar, carregando: alterar.isPending };
}

function DialogoTrocarPlano({ d, aberto, aoFechar }: PropsDialogo) {
  const planos = useListaPlanos();
  const [planoId, setPlanoId] = useState('');
  const { salvar, carregando } = useSalvarAssinatura(d, aoFechar);
  const opcoes = (planos.data ?? []).filter((p) => p.ativo && p.id !== d.plano?.id);
  const escolhido = opcoes.find((p) => p.id === planoId);
  const viraAtiva = !!escolhido && d.assinatura?.status_cadastrado === 'teste' && Number(escolhido.preco) > 0;

  return (
    <DialogoConfirmacao
      aberto={aberto}
      aoMudar={(v) => {
        if (!v) {
          aoFechar();
          setPlanoId('');
        }
      }}
      titulo={d.assinatura ? 'Trocar plano' : 'Atribuir plano'}
      descricao={
        d.plano ? `A clínica está no plano "${d.plano.nome}". Os novos limites valem imediatamente.` : 'Escolha o plano da clínica.'
      }
      textoConfirmar="Confirmar troca"
      carregando={carregando}
      desabilitado={!planoId}
      aoConfirmar={() => salvar({ plano_id: planoId }, `Plano alterado para "${escolhido?.nome}".`)}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="novo-plano">Novo plano</Label>
          <Select value={planoId} onValueChange={setPlanoId}>
            <SelectTrigger id="novo-plano" className="w-full">
              <SelectValue placeholder={planos.isLoading ? 'Carregando planos…' : 'Selecione o plano'} />
            </SelectTrigger>
            <SelectContent>
              {opcoes.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nome} — {Number(p.preco) > 0 ? `${formatarMoeda(p.preco)}/mês` : 'Gratuito'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!planos.isLoading && opcoes.length === 0 && (
            <p className="text-xs text-muted-foreground">Não há outro plano ativo disponível.</p>
          )}
        </div>
        {escolhido && (
          <ComparativoLimites d={d} recursos={escolhido.recursos} />
        )}
        {viraAtiva && (
          <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
            A clínica sai do teste grátis: a assinatura passará para o status “Ativa”.
          </p>
        )}
      </div>
    </DialogoConfirmacao>
  );
}

/** Mostra, para cada limite, o uso atual e o limite novo (destaca quando o novo limite fica abaixo do uso). */
function ComparativoLimites({
  d,
  recursos,
}: {
  d: DetalheClinicaAdmin;
  recursos: { codigo: CodigoRecurso; nome: string; tipo: string; habilitado: boolean; limite: number | null }[];
}) {
  const linhas = recursos.filter((r) => r.tipo === 'limite');
  return (
    <ul className="divide-y rounded-md border text-xs">
      {linhas.map((r) => {
        const uso = d.recursos[r.codigo]?.uso ?? 0;
        const acima = r.habilitado && r.limite !== null && uso > r.limite;
        return (
          <li key={r.codigo} className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span>{r.nome}</span>
            <span className={cn('tabular-nums', acima ? 'font-medium text-destructive' : 'text-muted-foreground')}>
              uso {uso} → {!r.habilitado ? 'não incluso' : r.limite === null ? 'ilimitado' : `limite ${r.limite}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function DialogoStatus({ d, aberto, aoFechar }: PropsDialogo) {
  const atual = d.assinatura?.status_cadastrado ?? 'teste';
  const [status, setStatus] = useState<StatusAssinatura>(atual);
  const { salvar, carregando } = useSalvarAssinatura(d, aoFechar);
  const leitura = ['vencida', 'cancelada', 'bloqueada'].includes(status);

  return (
    <DialogoConfirmacao
      aberto={aberto}
      aoMudar={(v) => {
        if (!v) aoFechar();
        else setStatus(atual);
      }}
      titulo="Mudar status da assinatura"
      descricao={`Status atual: ${ROTULOS_STATUS_ASSINATURA[atual]}.`}
      textoConfirmar="Salvar status"
      perigo={leitura}
      carregando={carregando}
      desabilitado={status === atual}
      aoConfirmar={() => salvar({ status }, `Status alterado para "${ROTULOS_STATUS_ASSINATURA[status]}".`)}
    >
      <div className="space-y-2">
        <Label htmlFor="novo-status">Novo status</Label>
        <Select value={status} onValueChange={(v) => setStatus(v as StatusAssinatura)}>
          <SelectTrigger id="novo-status" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ROTULOS_STATUS_ASSINATURA) as StatusAssinatura[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ROTULOS_STATUS_ASSINATURA[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className={cn('text-xs', leitura ? 'text-destructive' : 'text-muted-foreground')}>{DESCRICAO_STATUS[status]}</p>
      </div>
    </DialogoConfirmacao>
  );
}

function DialogoExpiracao({ d, aberto, aoFechar }: PropsDialogo) {
  const inicial = d.assinatura?.expira_em ? format(parseISO(d.assinatura.expira_em), 'yyyy-MM-dd') : '';
  const [data, setData] = useState(inicial);
  const [semExpiracao, setSemExpiracao] = useState(!inicial);
  const { salvar, carregando } = useSalvarAssinatura(d, aoFechar);
  const passado = !semExpiracao && !!data && data < format(new Date(), 'yyyy-MM-dd');

  function confirmar() {
    // Expira no fim do dia escolhido (horário local do navegador).
    const expira = semExpiracao ? null : new Date(`${data}T23:59:59`).toISOString();
    salvar({ expira_em: expira }, semExpiracao ? 'Expiração removida.' : `Assinatura válida até ${formatarData(expira)}.`);
  }

  return (
    <DialogoConfirmacao
      aberto={aberto}
      aoMudar={(v) => {
        if (!v) aoFechar();
        else {
          setData(inicial);
          setSemExpiracao(!inicial);
        }
      }}
      titulo="Definir expiração"
      descricao="Após a data de expiração, a assinatura passa a ser considerada vencida (modo somente leitura)."
      textoConfirmar="Salvar"
      carregando={carregando}
      desabilitado={!semExpiracao && !data}
      aoConfirmar={confirmar}
    >
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="expira-em">Válida até</Label>
          <Input id="expira-em" type="date" value={data} disabled={semExpiracao} onChange={(e) => setData(e.target.value)} />
        </div>
        <Label className="flex items-center gap-2 font-normal">
          <Checkbox checked={semExpiracao} onCheckedChange={(v) => setSemExpiracao(v === true)} />
          Sem data de expiração
        </Label>
        {passado && (
          <p className="text-xs text-destructive">Data no passado: a assinatura ficará vencida imediatamente.</p>
        )}
      </div>
    </DialogoConfirmacao>
  );
}

function DialogoSituacao({ d, aberto, aoFechar }: PropsDialogo) {
  const alterar = useAlterarSituacaoClinica(d.clinica.id);
  const ativa = d.clinica.status === 'ativa';
  return (
    <DialogoConfirmacao
      aberto={aberto}
      aoMudar={(v) => !v && aoFechar()}
      titulo={ativa ? 'Desativar clínica?' : 'Reativar clínica?'}
      descricao={
        ativa
          ? `Os usuários de "${d.clinica.nome}" não conseguirão mais entrar no sistema. Os dados são mantidos e a clínica pode ser reativada depois.`
          : `Os usuários de "${d.clinica.nome}" voltarão a ter acesso ao sistema.`
      }
      textoConfirmar={ativa ? 'Desativar' : 'Reativar'}
      perigo={ativa}
      carregando={alterar.isPending}
      aoConfirmar={async () => {
        try {
          await alterar.mutateAsync(ativa ? 'inativa' : 'ativa');
          toast.success(ativa ? 'Clínica desativada.' : 'Clínica reativada.');
          aoFechar();
        } catch (e) {
          toast.error(mensagemDeErro(e));
        }
      }}
    />
  );
}
