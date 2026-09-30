/**
 * Faturas da própria clínica (admin da clínica) — GET /cobrancas/minhas, só leitura.
 * Renderizado em Configurações (só para o papel admin). Não renderiza nada se a clínica nunca teve
 * cobrança (planos gratuitos / cobrança manual).
 */
import { ExternalLink, Receipt } from 'lucide-react';
import { useMinhasCobrancas } from '@/api/adminCobranca';
import { mensagemDeErro } from '@/api/cliente';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Skeleton } from '@/componentes/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, formatarMoeda } from '@/lib/formatos';
import { BadgeStatusCobranca } from '@/paginas/admin/cobranca/comum';

export default function MinhasFaturas({ className }: { className?: string }) {
  const { data, isLoading, isError, error } = useMinhasCobrancas();

  if (!isLoading && !isError && (!data || data.length === 0)) return null;

  const emAberto = data?.filter((c) => c.status === 'pendente' || c.status === 'vencida') ?? [];

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-5 text-muted-foreground" /> Faturas do sistema
        </CardTitle>
        <CardDescription>
          {emAberto.length
            ? `${emAberto.length} fatura(s) em aberto. Pague pelo link para manter o acesso completo.`
            : 'Mensalidades do sistema e seus pagamentos.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {isLoading ? (
          <div className="space-y-2 px-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <p className="px-6 text-sm text-destructive">{mensagemDeErro(error)}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Vencimento</TableHead>
                <TableHead className="hidden sm:table-cell">Descrição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-6 text-right">
                  <span className="sr-only">Pagar</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data!.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-6 tabular-nums">
                    {formatarData(c.vencimento)}
                    {c.pago_em && <p className="text-xs text-muted-foreground">pago em {formatarData(c.pago_em)}</p>}
                  </TableCell>
                  <TableCell className="hidden max-w-64 truncate text-muted-foreground sm:table-cell">{c.descricao ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatarMoeda(c.valor)}</TableCell>
                  <TableCell>
                    <BadgeStatusCobranca status={c.status} />
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    {c.link_pagamento && (
                      <Button asChild size="sm" variant={c.status === 'vencida' ? 'default' : 'outline'}>
                        <a href={c.link_pagamento} target="_blank" rel="noopener noreferrer">
                          Pagar <ExternalLink />
                        </a>
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
