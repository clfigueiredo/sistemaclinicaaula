// Componentes auxiliares dos cadastros (profissionais, convênios, usuários).
import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { Button } from '@/componentes/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/componentes/ui/dialog';
import { cn } from '@/lib/utils';

const CODIGOS_JA_NOTIFICADOS = new Set(['limite_atingido', 'recurso_indisponivel', 'assinatura_inativa']);

/** Toast de erro, sem duplicar os que o cliente HTTP já mostra (limite do plano / assinatura). */
export function toastErro(e: unknown) {
  if (e instanceof ErroApi && e.status === 403 && CODIGOS_JA_NOTIFICADOS.has(e.codigo)) return;
  toast.error(mensagemDeErro(e));
}

/** Iniciais do nome (ignora títulos como Dr./Dra.). */
export function iniciais(nome: string): string {
  const partes = nome
    .replace(/^(dr|dra|prof|profa)\.?\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (partes.length === 0) return '?';
  const primeira = partes[0]![0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]![0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}

/** Avatar redondo com as iniciais na cor da agenda. */
export function AvatarCor({
  nome,
  cor,
  tamanho = 'md',
  apagado = false,
}: {
  nome: string;
  cor: string;
  tamanho?: 'sm' | 'md' | 'lg';
  apagado?: boolean;
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-sm',
        tamanho === 'sm' && 'size-7 text-[11px]',
        tamanho === 'md' && 'size-10 text-sm',
        tamanho === 'lg' && 'size-14 text-lg',
        apagado && 'opacity-50 grayscale',
      )}
      style={{ backgroundColor: cor }}
      aria-hidden
    >
      {iniciais(nome)}
    </span>
  );
}

/** Bolinha de cor (ex.: cor da agenda). */
export function BolinhaCor({ cor, className }: { cor: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-full ring-2 ring-background', className)}
      style={{ backgroundColor: cor }}
      aria-hidden
    />
  );
}

/** Badge de status ativo/inativo. */
export function BadgeStatus({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        ativo ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', ativo ? 'bg-success' : 'bg-muted-foreground/60')} />
      {ativo ? 'Ativo' : 'Inativo'}
    </span>
  );
}

type Confirmacao = {
  titulo: string;
  descricao?: ReactNode;
  rotuloConfirmar?: string;
  destrutivo?: boolean;
  acao: () => Promise<unknown> | unknown;
};

/**
 * Diálogo de confirmação controlado por hook:
 *   const { confirmar, dialogo } = useConfirmacao();
 *   confirmar({ titulo: 'Desativar?', acao: () => mutateAsync(...) });
 *   return <>{...}{dialogo}</>;
 */
export function useConfirmacao() {
  const [atual, setAtual] = useState<Confirmacao | null>(null);
  const [executando, setExecutando] = useState(false);

  async function executar() {
    if (!atual) return;
    setExecutando(true);
    try {
      await atual.acao();
      setAtual(null);
    } catch {
      /* o chamador mostra o toast de erro */
    } finally {
      setExecutando(false);
    }
  }

  const dialogo = (
    <Dialog open={!!atual} onOpenChange={(aberto) => !aberto && !executando && setAtual(null)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{atual?.titulo}</DialogTitle>
          {atual?.descricao && <DialogDescription>{atual.descricao}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAtual(null)} disabled={executando}>
            Cancelar
          </Button>
          <Button variant={atual?.destrutivo ? 'destructive' : 'default'} onClick={executar} disabled={executando}>
            {executando && <Loader2 className="size-4 animate-spin" />}
            {atual?.rotuloConfirmar ?? 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { confirmar: setAtual, dialogo };
}

/** Mensagem de erro em bloco (para estados de erro de carregamento). */
export function ErroCarregamento({ mensagem, tentarNovamente }: { mensagem: string; tentarNovamente?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center">
      <p className="font-medium text-destructive">Não foi possível carregar os dados</p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{mensagem}</p>
      {tentarNovamente && (
        <Button variant="outline" size="sm" className="mt-4" onClick={tentarNovamente}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}
