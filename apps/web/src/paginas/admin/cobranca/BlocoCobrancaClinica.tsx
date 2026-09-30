/**
 * Bloco "Cobrança" do detalhe da clínica (super admin): status da cobrança automática, últimas cobranças
 * e ações (gerar cobrança avulsa, ligar/atualizar/desligar a cobrança automática).
 * Dados: GET /admin/cobranca/clinicas/:id (useCobrancaClinica).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, ExternalLink, Plus, Receipt, Repeat } from 'lucide-react';
import { useCobrancaClinica, useGatewaysPagamento } from '@/api/adminCobranca';
import { mensagemDeErro } from '@/api/cliente';
import { ROTULOS_METODO_COBRANCA, ROTULOS_PROVEDOR_PAGAMENTO } from '@/api/tipos';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Skeleton } from '@/componentes/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/componentes/ui/table';
import { formatarData, formatarMoeda } from '@/lib/formatos';
import { DialogoCobrancaAutomatica, DialogoGerarCobranca } from './AbaCobrancas';
import { BadgeStatusCobranca } from './comum';

export default function BlocoCobrancaClinica({ clinicaId }: { clinicaId: string }) {
  const { data, isLoading, isError, error } = useCobrancaClinica(clinicaId);
  const gateways = useGatewaysPagamento();
  const gatewayAtivo = gateways.data?.find((g) => g.ativo) ?? null;
  const [dialogo, setDialogo] = useState<'gerar' | 'automatica' | null>(null);

  const assinatura = data?.assinatura ?? null;
  const planoPago = assinatura ? Number(assinatura.plano.preco) > 0 : false;

  return (
    <Card className="pb-0">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Receipt className="size-4" /> Cobrança
            </CardTitle>
            <CardDescription>
              {gatewayAtivo
                ? `Mensalidades emitidas no ${gatewayAtivo.nome} (gateway ativo).`
                : 'Nenhum gateway de pagamento ativo — configure um em Cobrança.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!assinatura} onClick={() => setDialogo('automatica')}>
              <Repeat /> Cobrança automática
            </Button>
            <Button size="sm" disabled={!gatewayAtivo || !assinatura} onClick={() => setDialogo('gerar')}>
              <Plus /> Gerar cobrança
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {isLoading ? (
          <div className="space-y-2 px-6 pb-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : isError ? (
          <p className="px-6 pb-6 text-sm text-destructive">{mensagemDeErro(error)}</p>
        ) : (
          <>
            <div className="px-6">
              <p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {!assinatura
                    ? 'Sem assinatura: atribua um plano para poder cobrar.'
                    : !planoPago
                      ? 'Plano gratuito: não há cobrança.'
                      : assinatura.cobranca_automatica
                        ? `Cobrança automática ligada: vence todo dia ${assinatura.dia_vencimento}${
                            assinatura.gateway ? ` no ${ROTULOS_PROVEDOR_PAGAMENTO[assinatura.gateway]}` : ''
                          }${assinatura.metodo_cobranca ? ` (${ROTULOS_METODO_COBRANCA[assinatura.metodo_cobranca]})` : ''}.`
                        : 'Cobrança automática desligada: as mensalidades não são geradas sozinhas.'}
                </span>
              </p>
            </div>
            {data && data.cobrancas.length === 0 ? (
              <p className="px-6 pb-6 text-sm text-muted-foreground">Nenhuma cobrança emitida para esta clínica.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Vencimento</TableHead>
                    <TableHead className="hidden sm:table-cell">Descrição</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">
                      <span className="sr-only">Link</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.cobrancas.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-6 tabular-nums">
                        {formatarData(c.vencimento)}
                        {c.pago_em && <p className="text-xs text-muted-foreground">pago em {formatarData(c.pago_em)}</p>}
                      </TableCell>
                      <TableCell className="hidden max-w-64 truncate text-muted-foreground sm:table-cell">
                        {c.descricao ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatarMoeda(c.valor)}</TableCell>
                      <TableCell>
                        <BadgeStatusCobranca status={c.status} />
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {c.link_pagamento && (
                          <Button asChild size="icon" variant="ghost" className="size-8" title="Abrir link de pagamento">
                            <a href={c.link_pagamento} target="_blank" rel="noopener noreferrer" aria-label="Abrir link de pagamento">
                              <ExternalLink />
                            </a>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <div className="border-t px-6 py-3 text-right">
              <Button variant="link" size="sm" asChild className="h-auto p-0">
                <Link to={`/admin/cobranca?clinica=${clinicaId}`}>Ver todas as cobranças</Link>
              </Button>
            </div>
          </>
        )}
      </CardContent>

      {dialogo === 'gerar' && (
        <DialogoGerarCobranca
          clinicaInicial={clinicaId}
          fixarClinica
          metodos={gatewayAtivo?.metodos ?? []}
          nomeGateway={gatewayAtivo?.nome ?? null}
          aoFechar={() => setDialogo(null)}
        />
      )}
      {dialogo === 'automatica' && (
        <DialogoCobrancaAutomatica
          clinicaInicial={clinicaId}
          fixarClinica
          diaPadrao={gatewayAtivo?.dia_vencimento_padrao ?? 10}
          metodos={gatewayAtivo?.metodos ?? []}
          nomeGateway={gatewayAtivo?.nome ?? null}
          aoFechar={() => setDialogo(null)}
        />
      )}
    </Card>
  );
}
