/**
 * Planos (admin da clínica): contratação de um plano pago com pagamento online.
 * O plano só muda quando o gateway confirma o pagamento (webhook); enquanto houver cobrança pendente a página
 * consulta a API de 10 em 10 s e avisa quando o plano for liberado.
 * `?plano=<id>` (vindo da landing page / cadastro) destaca o plano escolhido.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Clock, CreditCard, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/api/cliente';
import {
  descreverRecurso,
  useAtualizarAposPagamento,
  useContratacao,
  useContratarPlano,
  type PlanoPublico,
} from '@/api/contratacao';
import { ROTULOS_STATUS_ASSINATURA } from '@/api/tipos';
import { CabecalhoPagina, Carregando, EstadoVazio } from '@/componentes/comum';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/componentes/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { formatarData, formatarMoeda } from '@/lib/formatos';
import { cn } from '@/lib/utils';

export default function PaginaPlanos() {
  const [params] = useSearchParams();
  const escolhidoNoSite = params.get('plano');
  const { data, isLoading, isError, error, refetch, isFetching } = useContratacao();
  const contratar = useContratarPlano();
  const atualizarAposPagamento = useAtualizarAposPagamento();
  const [confirmando, setConfirmando] = useState<PlanoPublico | null>(null);

  // Pagamento confirmado: a cobrança pendente some e o plano atual passa a ser o contratado.
  const anterior = useRef<{ pendente: string | null; plano: string | null } | null>(null);
  useEffect(() => {
    if (!data) return;
    const atual = { pendente: data.pendente?.plano_contratado_id ?? null, plano: data.plano_atual?.id ?? null };
    const antes = anterior.current;
    if (antes?.pendente && !atual.pendente && atual.plano === antes.pendente) {
      toast.success(`Pagamento confirmado! Seu plano ${data.plano_atual?.nome} já está liberado.`);
      atualizarAposPagamento();
    }
    anterior.current = atual;
  }, [data, atualizarAposPagamento]);

  if (isLoading) return <Carregando />;
  if (isError || !data) {
    return (
      <div>
        <CabecalhoPagina titulo="Planos" />
        <Alert variant="destructive">
          <AlertTitle>Não foi possível carregar os planos</AlertTitle>
          <AlertDescription>
            <p>
              {mensagemDeErro(error)}{' '}
              <button type="button" className="underline" onClick={() => refetch()}>
                Tentar de novo
              </button>
            </p>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { plano_atual, pendente } = data;

  async function irParaPagamento(plano: PlanoPublico) {
    try {
      const r = await contratar.mutateAsync(plano.id);
      if (!r.link_pagamento) {
        toast.error('A cobrança foi gerada, mas o gateway não devolveu o link de pagamento. Fale com o suporte.');
        return;
      }
      window.location.assign(r.link_pagamento);
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  return (
    <div>
      <CabecalhoPagina
        titulo="Planos"
        descricao="Escolha o plano ideal para a sua clínica. Pague por Pix, boleto ou cartão e o plano é liberado assim que o pagamento for confirmado."
        acoes={
          <Button variant="outline" asChild>
            <Link to="/configuracoes">Ver uso e limites</Link>
          </Button>
        }
      />

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Plano atual:</span>
          <span className="font-medium">{plano_atual?.nome ?? '—'}</span>
          {data.status_assinatura && <Badge variant="secondary">{ROTULOS_STATUS_ASSINATURA[data.status_assinatura]}</Badge>}
        </div>

        {pendente && (
          <Alert>
            <Clock className="size-4" />
            <AlertTitle>Aguardando o pagamento do plano {pendente.plano_nome ?? ''}</AlertTitle>
            <AlertDescription>
              <p>
                Fatura de {formatarMoeda(pendente.valor)} gerada em {formatarData(pendente.criado_em)}. Pix e cartão são
                confirmados em instantes; boleto, em até 3 dias úteis. Esta página se atualiza sozinha.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pendente.link_pagamento && (
                  <Button asChild size="sm">
                    <a href={pendente.link_pagamento}>
                      Ir para o pagamento <ExternalLink />
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  {isFetching && <Loader2 className="animate-spin" />}
                  Já paguei, verificar
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {!data.pode_contratar && data.mensagem && (
          <Alert>
            <AlertDescription>
              <p>{data.mensagem}</p>
            </AlertDescription>
          </Alert>
        )}

        {data.planos.length === 0 ? (
          <EstadoVazio titulo="Nenhum plano disponível" descricao="No momento não há planos para contratação online. Fale com o suporte." />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.planos.map((plano) => {
              const atual = plano.id === plano_atual?.id;
              const destacado = plano.id === escolhidoNoSite || plano.id === pendente?.plano_contratado_id;
              return (
                <Card key={plano.id} className={cn('flex flex-col', destacado && 'border-primary ring-1 ring-primary')}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle>{plano.nome}</CardTitle>
                      {atual ? (
                        <Badge>Seu plano</Badge>
                      ) : plano.id === escolhidoNoSite ? (
                        <Badge variant="secondary">
                          <Sparkles /> Escolhido
                        </Badge>
                      ) : null}
                    </div>
                    {plano.descricao && <CardDescription>{plano.descricao}</CardDescription>}
                    <p className="pt-2">
                      <span className="text-3xl font-semibold tabular-nums">{formatarMoeda(plano.preco)}</span>
                      <span className="text-sm text-muted-foreground"> /mês</span>
                    </p>
                  </CardHeader>
                  <CardContent className="flex-1">
                    <ul className="space-y-2 text-sm">
                      {plano.recursos.map((r) => (
                        <li key={r.codigo} className="flex items-start gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                          <span>{descreverRecurso(r)}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                  <CardFooter>
                    <Button
                      className="w-full"
                      variant={destacado ? 'default' : 'outline'}
                      disabled={!data.pode_contratar || atual || contratar.isPending}
                      title={!data.pode_contratar ? (data.mensagem ?? undefined) : undefined}
                      onClick={() => setConfirmando(plano)}
                    >
                      <CreditCard />
                      {pendente?.plano_contratado_id === plano.id ? 'Pagar agora' : 'Assinar'}
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={!!confirmando} onOpenChange={(v) => !v && !contratar.isPending && setConfirmando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assinar o plano {confirmando?.nome}</DialogTitle>
            <DialogDescription>
              {confirmando && `${formatarMoeda(confirmando.preco)} por mês.`} Você será levado à página de pagamento
              segura para pagar por Pix, boleto ou cartão.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            <li>O plano é liberado assim que o pagamento for confirmado (Pix e cartão: na hora; boleto: até 3 dias úteis).</li>
            <li>A mensalidade seguinte é gerada automaticamente todo mês, na mesma data.</li>
            {pendente && pendente.plano_contratado_id !== confirmando?.id && (
              <li>A fatura pendente do plano {pendente.plano_nome} será cancelada.</li>
            )}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(null)} disabled={contratar.isPending}>
              Voltar
            </Button>
            <Button onClick={() => confirmando && irParaPagamento(confirmando)} disabled={contratar.isPending}>
              {contratar.isPending && <Loader2 className="animate-spin" />}
              Ir para o pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
