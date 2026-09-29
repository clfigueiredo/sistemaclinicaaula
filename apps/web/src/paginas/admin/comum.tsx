/**
 * Componentes reutilizados pelas páginas do painel super admin.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ROTULOS_STATUS_ASSINATURA, type StatusAssinatura } from '@/api/tipos';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { cn } from '@/lib/utils';

const CORES_STATUS: Record<StatusAssinatura, string> = {
  teste: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  ativa: 'border-success/30 bg-success/10 text-success',
  vencida: 'border-warning/40 bg-warning/15 text-amber-700 dark:text-amber-300',
  cancelada: 'border-border bg-muted text-muted-foreground',
  bloqueada: 'border-destructive/30 bg-destructive/10 text-destructive',
};

export const COR_BARRA_STATUS: Record<StatusAssinatura, string> = {
  teste: 'bg-sky-500',
  ativa: 'bg-success',
  vencida: 'bg-warning',
  cancelada: 'bg-muted-foreground/50',
  bloqueada: 'bg-destructive',
};

export function BadgeStatusAssinatura({ status, className }: { status: StatusAssinatura | null; className?: string }) {
  if (!status) {
    return (
      <Badge variant="outline" className={className}>
        Sem assinatura
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(CORES_STATUS[status], className)}>
      {ROTULOS_STATUS_ASSINATURA[status]}
    </Badge>
  );
}

export function BadgeSituacao({ ativa, rotuloAtivo = 'Ativa', rotuloInativo = 'Inativa' }: { ativa: boolean; rotuloAtivo?: string; rotuloInativo?: string }) {
  return (
    <Badge variant="outline" className={ativa ? 'border-success/30 bg-success/10 text-success' : 'text-muted-foreground'}>
      <span className={cn('size-1.5 rounded-full', ativa ? 'bg-success' : 'bg-muted-foreground/60')} />
      {ativa ? rotuloAtivo : rotuloInativo}
    </Badge>
  );
}

/** Barra de progresso de uso x limite. limite null = ilimitado (barra neutra). */
export function BarraUso({ uso, limite, className }: { uso: number; limite: number | null; className?: string }) {
  const pct = limite === null ? 0 : limite === 0 ? 100 : Math.min(100, Math.round((uso / limite) * 100));
  const cor = limite === null ? 'bg-primary/40' : pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary';
  return (
    <div
      className={cn('h-2 overflow-hidden rounded-full bg-muted', className)}
      role="progressbar"
      aria-valuenow={uso}
      aria-valuemin={0}
      aria-valuemax={limite ?? undefined}
    >
      <div className={cn('h-full rounded-full transition-all', cor)} style={{ width: limite === null ? '100%' : `${pct}%` }} />
    </div>
  );
}

export function CardKpi({
  titulo,
  valor,
  detalhe,
  icone,
  destaque,
}: {
  titulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  icone: ReactNode;
  destaque?: 'primario' | 'sucesso' | 'alerta' | 'perigo';
}) {
  const cores = {
    primario: 'bg-primary/10 text-primary',
    sucesso: 'bg-success/10 text-success',
    alerta: 'bg-warning/15 text-amber-700 dark:text-amber-300',
    perigo: 'bg-destructive/10 text-destructive',
  };
  return (
    <Card className="gap-0 py-5">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{titulo}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{valor}</p>
          {detalhe && <p className="mt-1 text-xs text-muted-foreground">{detalhe}</p>}
        </div>
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', cores[destaque ?? 'primario'])}>{icone}</span>
      </CardContent>
    </Card>
  );
}

/** Diálogo de confirmação genérico. */
export function DialogoConfirmacao({
  aberto,
  aoMudar,
  titulo,
  descricao,
  children,
  textoConfirmar = 'Confirmar',
  perigo = false,
  carregando = false,
  desabilitado = false,
  aoConfirmar,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  descricao?: ReactNode;
  children?: ReactNode;
  textoConfirmar?: string;
  perigo?: boolean;
  carregando?: boolean;
  desabilitado?: boolean;
  aoConfirmar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !carregando && aoMudar(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {perigo && <AlertTriangle className="size-5 text-destructive" />}
            {titulo}
          </DialogTitle>
          {descricao && <DialogDescription>{descricao}</DialogDescription>}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => aoMudar(false)} disabled={carregando}>
            Cancelar
          </Button>
          <Button variant={perigo ? 'destructive' : 'default'} onClick={aoConfirmar} disabled={carregando || desabilitado}>
            {carregando && <Loader2 className="size-4 animate-spin" />}
            {textoConfirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Estado de erro com botão de tentar novamente. */
export function ErroCarregar({ mensagem, aoTentar }: { mensagem: string; aoTentar?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <p className="font-medium">Não foi possível carregar</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{mensagem}</p>
      {aoTentar && (
        <Button variant="outline" size="sm" className="mt-4" onClick={aoTentar}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

/** Texto de uso: "3 de 10", "3 · ilimitado". */
export function textoUso(uso: number | null, limite: number | null, periodo?: string | null) {
  if (uso === null) return '—';
  if (limite === null) return `${uso} · ilimitado`;
  return `${uso} de ${limite}${periodo === 'mensal' ? ' no mês' : ''}`;
}
