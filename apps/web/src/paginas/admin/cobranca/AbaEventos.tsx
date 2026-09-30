/**
 * Aba "Eventos": log dos webhooks recebidos dos gateways (depuração). Só eventos AUTÊNTICOS são gravados —
 * webhooks com assinatura/token inválido são recusados (401) antes de chegar aqui.
 */
import { useState } from 'react';
import { FileJson, Webhook } from 'lucide-react';
import { useEventosGateway, type EventoGateway } from '@/api/adminCobranca';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_PROVEDOR_PAGAMENTO, type ProvedorPagamento } from '@/api/tipos';
import { Carregando, EstadoVazio } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card } from '@/componentes/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/componentes/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarDataHora } from '@/lib/formatos';
import { ErroCarregar } from '../comum';
import { BotaoCopiar, Paginacao } from './comum';

const POR_PAGINA = 25;
const TODOS = 'todos';

function Situacao({ evento }: { evento: EventoGateway }) {
  if (evento.processado_em && !evento.erro) {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        Processado
      </Badge>
    );
  }
  if (evento.processado_em && evento.erro) {
    return (
      <Badge variant="outline" className="border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300">
        Processado com aviso
      </Badge>
    );
  }
  if (evento.erro) {
    return (
      <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
        Erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      Em processamento
    </Badge>
  );
}

export default function AbaEventos() {
  const [gateway, setGateway] = useState<ProvedorPagamento | ''>('');
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<EventoGateway | null>(null);
  const { data, isLoading, isError, error, refetch, isFetching } = useEventosGateway({
    gateway: gateway || undefined,
    pagina,
    por_pagina: POR_PAGINA,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={gateway || TODOS}
          onValueChange={(v) => {
            setGateway(v === TODOS ? '' : (v as ProvedorPagamento));
            setPagina(1);
          }}
        >
          <SelectTrigger className="w-48" aria-label="Gateway">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Todos os gateways</SelectItem>
            {(Object.keys(ROTULOS_PROVEDOR_PAGAMENTO) as ProvedorPagamento[]).map((g) => (
              <SelectItem key={g} value={g}>
                {ROTULOS_PROVEDOR_PAGAMENTO[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          Atualizar
        </Button>
      </div>

      {isLoading ? (
        <Carregando />
      ) : isError || !data ? (
        <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />
      ) : data.itens.length === 0 ? (
        <EstadoVazio
          icone={<Webhook className="size-5" />}
          titulo="Nenhum webhook recebido"
          descricao="Os eventos aparecem aqui quando o gateway notificar um pagamento. Confira a URL e o segredo do webhook na aba Gateways."
        />
      ) : (
        <>
          <Card className="py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Recebido em</TableHead>
                  <TableHead>Gateway</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="hidden lg:table-cell">ID do evento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="w-12 pr-4">
                    <span className="sr-only">Detalhes</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.itens.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-4 whitespace-nowrap tabular-nums">{formatarDataHora(e.recebido_em)}</TableCell>
                    <TableCell>{ROTULOS_PROVEDOR_PAGAMENTO[e.gateway]}</TableCell>
                    <TableCell>
                      <code className="text-xs">{e.tipo}</code>
                    </TableCell>
                    <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground lg:table-cell" title={e.id_evento}>
                      {e.id_evento}
                    </TableCell>
                    <TableCell>
                      <Situacao evento={e} />
                      {e.erro && <p className="mt-0.5 max-w-64 truncate text-xs text-muted-foreground" title={e.erro}>{e.erro}</p>}
                    </TableCell>
                    <TableCell className="pr-4">
                      <Button variant="ghost" size="icon" aria-label="Ver payload" onClick={() => setAberto(e)}>
                        <FileJson />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Paginacao pagina={pagina} total={data.total} porPagina={POR_PAGINA} rotulo={['evento', 'eventos']} aoMudar={setPagina} />
        </>
      )}

      <Dialog open={!!aberto} onOpenChange={(v) => !v && setAberto(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{aberto?.tipo}</DialogTitle>
            <DialogDescription>
              {aberto && `${ROTULOS_PROVEDOR_PAGAMENTO[aberto.gateway]} · ${formatarDataHora(aberto.recebido_em)} · ${aberto.id_evento}`}
            </DialogDescription>
          </DialogHeader>
          {aberto && (
            <div className="space-y-2">
              <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(aberto.payload, null, 2)}
              </pre>
              <div className="flex justify-end">
                <BotaoCopiar texto={JSON.stringify(aberto.payload, null, 2)} rotulo="Copiar JSON" mensagem="Payload copiado." />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
