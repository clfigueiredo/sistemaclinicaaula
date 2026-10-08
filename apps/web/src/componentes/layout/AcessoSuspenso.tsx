/**
 * Tela única da clínica com a assinatura vencida/cancelada/bloqueada (acesso suspenso — a API recusa tudo menos
 * GET /me e GET /cobrancas/minhas). O admin vê as faturas em aberto para pagar; os demais papéis, um aviso para
 * procurar o administrador. Consulta o /me a cada 15 s: quando o pagamento é confirmado (webhook), o sistema libera
 * sozinho.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut, Lock } from 'lucide-react';
import { useMe, chavesMe } from '@/api/me';
import { chavesAdminCobranca } from '@/api/adminCobranca';
import type { Me } from '@/api/tipos';
import { Logo } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import MinhasFaturas from '@/paginas/clinica/configuracoes/MinhasFaturas';

export function AcessoSuspenso({ me, aoSair }: { me: Me; aoSair: () => void }) {
  const qc = useQueryClient();
  const { isFetching } = useMe();
  const vencida = me.assinatura?.status === 'vencida';

  // Polling do /me (e das faturas): libera assim que o pagamento for confirmado.
  useEffect(() => {
    const t = setInterval(() => {
      qc.invalidateQueries({ queryKey: chavesMe.me, exact: true });
      qc.invalidateQueries({ queryKey: chavesAdminCobranca.minhas });
    }, 15_000);
    return () => clearInterval(t);
  }, [qc]);

  function verificar() {
    qc.invalidateQueries({ queryKey: chavesMe.me, exact: true });
    qc.invalidateQueries({ queryKey: chavesAdminCobranca.minhas });
  }

  return (
    <div className="min-h-svh bg-muted/40 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <Button variant="ghost" size="sm" onClick={aoSair}>
            <LogOut /> Sair
          </Button>
        </div>

        <Card>
          <CardHeader>
            <div className="mb-2 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
              <Lock className="size-5" />
            </div>
            <CardTitle className="text-xl">Acesso suspenso</CardTitle>
            <CardDescription className="text-base">
              {vencida
                ? `O acesso de ${me.clinica.nome} ao sistema está suspenso por falta de pagamento.`
                : `A assinatura de ${me.clinica.nome} está ${me.assinatura?.status === 'cancelada' ? 'cancelada' : 'bloqueada'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {me.papel === 'admin' ? (
              vencida ? (
                <p>
                  Pague a fatura em aberto abaixo (Pix, boleto ou cartão). Assim que o pagamento for confirmado o sistema é
                  liberado automaticamente — seus dados estão preservados.
                </p>
              ) : (
                <p>Fale com o suporte para regularizar a assinatura. Seus dados estão preservados.</p>
              )
            ) : (
              <p>Procure o administrador da clínica para regularizar a assinatura. Seus dados estão preservados.</p>
            )}
            <Button variant="outline" size="sm" onClick={verificar} disabled={isFetching}>
              {isFetching && <Loader2 className="animate-spin" />}
              Já paguei, verificar
            </Button>
          </CardContent>
        </Card>

        {me.papel === 'admin' && <MinhasFaturas />}
      </div>
    </div>
  );
}
