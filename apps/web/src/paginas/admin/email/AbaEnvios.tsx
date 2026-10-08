/**
 * Aba "Envios": histórico dos e-mails (enviados, pendentes, com falha e ignorados), com filtros, visualização
 * do e-mail como foi montado (iframe sem scripts) e reenvio dos que falharam ou foram ignorados.
 */
import { useEffect, useState } from 'react';
import { Eye, Loader2, MailX, RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  motivoEmail,
  ROTULOS_STATUS_EMAIL,
  ROTULOS_TIPO_EMAIL,
  useEnvioEmail,
  useEnviosEmail,
  useReenviarEmail,
  type StatusEmail,
  type TipoEmail,
} from '@/api/adminEmail';
import { mensagemDeErro } from '@/api/cliente';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Input } from '@/componentes/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { ErroCarregar } from '../comum';
import { Paginacao } from '../cobranca/comum';

const POR_PAGINA = 25;
const TODOS = 'todos';
const ATRASO_BUSCA_MS = 400;

const CORES_STATUS: Record<StatusEmail, string> = {
  enviado: 'border-success/30 bg-success/10 text-success',
  pendente: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  falhou: 'border-destructive/30 bg-destructive/10 text-destructive',
  ignorado: 'border-border bg-muted text-muted-foreground',
};

function BadgeStatusEmail({ status }: { status: StatusEmail }) {
  return (
    <Badge variant="outline" className={CORES_STATUS[status]}>
      {ROTULOS_STATUS_EMAIL[status]}
    </Badge>
  );
}

const podeReenviar = (status: StatusEmail) => status === 'falhou' || status === 'ignorado';

export default function AbaEnvios() {
  const [tipo, setTipo] = useState<TipoEmail | ''>('');
  const [status, setStatus] = useState<StatusEmail | ''>('');
  const [textoBusca, setTextoBusca] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setBusca(textoBusca.trim());
      setPagina(1);
    }, ATRASO_BUSCA_MS);
    return () => clearTimeout(t);
  }, [textoBusca]);

  const { data, isLoading, isError, error, refetch, isFetching } = useEnviosEmail({
    tipo: tipo || undefined,
    status: status || undefined,
    busca: busca || undefined,
    pagina,
    por_pagina: POR_PAGINA,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={textoBusca}
            onChange={(e) => setTextoBusca(e.target.value)}
            placeholder="Buscar destinatário"
            aria-label="Buscar destinatário"
            className="pl-8"
          />
        </div>
        <Select
          value={tipo || TODOS}
          onValueChange={(v) => {
            setTipo(v === TODOS ? '' : (v as TipoEmail));
            setPagina(1);
          }}
        >
          <SelectTrigger className="w-52" aria-label="Tipo de e-mail">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os tipos</SelectItem>
            {(Object.keys(ROTULOS_TIPO_EMAIL) as TipoEmail[]).map((t) => (
              <SelectItem key={t} value={t}>
                {ROTULOS_TIPO_EMAIL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status || TODOS}
          onValueChange={(v) => {
            setStatus(v === TODOS ? '' : (v as StatusEmail));
            setPagina(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os status</SelectItem>
            {(Object.keys(ROTULOS_STATUS_EMAIL) as StatusEmail[]).map((s) => (
              <SelectItem key={s} value={s}>
                {ROTULOS_STATUS_EMAIL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn(isFetching && 'animate-spin')} /> Atualizar
        </Button>
      </div>

      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : data.itens.length === 0 ? (
        <EstadoVazio
          icone={<MailX className="size-5" />}
          titulo="Nenhum e-mail encontrado"
          descricao="Os e-mails automáticos (boas-vindas, senha, pagamentos e avisos) aparecem aqui assim que forem gerados."
        />
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Criado em</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead className="hidden xl:table-cell">Clínica</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Ver</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itens.map((e) => {
                  const motivo = motivoEmail(e.erro);
                  return (
                    <TableRow key={e.id} className="cursor-pointer" onClick={() => setAberto(e.id)}>
                      <TableCell className="pl-4 whitespace-nowrap tabular-nums">{formatarDataHora(e.criado_em)}</TableCell>
                      <TableCell className="whitespace-nowrap">{ROTULOS_TIPO_EMAIL[e.tipo]}</TableCell>
                      <TableCell className="max-w-56">
                        <p className="truncate" title={e.destinatario}>
                          {e.destinatario}
                        </p>
                        <p className="truncate text-xs text-muted-foreground" title={e.assunto}>
                          {e.assunto}
                        </p>
                      </TableCell>
                      <TableCell className="hidden max-w-48 truncate xl:table-cell">{e.clinica?.nome ?? '—'}</TableCell>
                      <TableCell>
                        <BadgeStatusEmail status={e.status} />
                        {motivo && e.status !== 'enviado' && (
                          <p className="mt-0.5 max-w-56 truncate text-xs text-muted-foreground" title={motivo}>
                            {motivo}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="pr-4">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Ver e-mail"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setAberto(e.id);
                          }}
                        >
                          <Eye />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={data.total} porPagina={POR_PAGINA} rotulo={['e-mail', 'e-mails']} aoMudar={setPagina} />
        </>
      )}

      <DialogoEnvio id={aberto} aoFechar={() => setAberto(null)} />
    </div>
  );
}

function DialogoEnvio({ id, aoFechar }: { id: string | null; aoFechar: () => void }) {
  const { data, isLoading, isError, error } = useEnvioEmail(id);
  const reenviar = useReenviarEmail();
  const motivo = data ? motivoEmail(data.erro) : null;

  function aoReenviar() {
    if (!data) return;
    reenviar.mutate(data.id, {
      onSuccess: () => toast.success('E-mail colocado na fila de envio novamente.'),
      onError: (e) => toast.error(mensagemDeErro(e)),
    });
  }

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{data?.assunto ?? 'E-mail'}</DialogTitle>
          <DialogDescription>
            {data &&
              `${ROTULOS_TIPO_EMAIL[data.tipo]} · para ${data.destinatario} · criado em ${formatarDataHora(data.criado_em)}${
                data.enviado_em ? ` · enviado em ${formatarDataHora(data.enviado_em)}` : ''
              }`}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <Carregando />
        ) : isError || !data ? (
          <ErroCarregar mensagem={mensagemDeErro(error)} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <BadgeStatusEmail status={data.status} />
              {data.clinica && <span className="text-muted-foreground">Clínica: {data.clinica.nome}</span>}
              <span className="text-muted-foreground">
                {data.tentativas} {data.tentativas === 1 ? 'tentativa' : 'tentativas'}
              </span>
            </div>
            {motivo && data.status !== 'enviado' && (
              <p className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
                <span className="font-medium">Motivo: </span>
                {motivo}
              </p>
            )}
            <iframe title="E-mail enviado" sandbox="" srcDoc={data.html} className="h-[55vh] w-full rounded-lg border bg-white" />
          </div>
        )}
        {data && podeReenviar(data.status) && (
          <DialogFooter>
            <Button onClick={aoReenviar} disabled={reenviar.isPending}>
              {reenviar.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Reenviar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
