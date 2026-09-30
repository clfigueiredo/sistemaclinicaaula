/**
 * Componentes comuns reutilizáveis por todas as páginas.
 *
 *   <CabecalhoPagina titulo="Pacientes" descricao="..." acoes={<Button>Novo</Button>} />
 *   <Carregando />                         // spinner centralizado
 *   <EstadoVazio titulo="Nenhum paciente" descricao="..." acao={<Button/>} />
 *   <AvisoLimite codigo="max_profissionais" />   // alerta quando o plano não permite mais
 *   <UsoRecurso codigo="max_profissionais" />    // "1 de 1 usados"
 *   <PaginaEmConstrucao titulo="..." />
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Construction, Inbox, Loader2, Lock, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@/componentes/ui/alert';
import { Badge } from '@/componentes/ui/badge';
import { usePodeUsar } from '@/api/me';
import type { CodigoRecurso } from '@/api/tipos';

export function Logo({ className, claro = false }: { className?: string; claro?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 font-semibold tracking-tight', className)}>
      <span
        className={cn(
          'grid size-8 place-items-center rounded-lg',
          claro ? 'bg-white/15 text-white' : 'bg-primary text-primary-foreground',
        )}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
          <path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" />
        </svg>
      </span>
      <span className={claro ? 'text-white' : undefined}>Sistema Clínica</span>
    </div>
  );
}

export function CabecalhoPagina({
  titulo,
  descricao,
  acoes,
  className,
}: {
  titulo: ReactNode;
  descricao?: ReactNode;
  acoes?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
      </div>
      {acoes && <div className="flex shrink-0 flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}

export function Carregando({ texto = 'Carregando…', telaCheia = false }: { texto?: string; telaCheia?: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 text-sm text-muted-foreground',
        telaCheia ? 'min-h-screen' : 'py-16',
      )}
      role="status"
    >
      <Loader2 className="size-4 animate-spin" />
      {texto}
    </div>
  );
}

export function EstadoVazio({
  titulo,
  descricao,
  acao,
  icone,
}: {
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  icone?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        {icone ?? <Inbox className="size-5" />}
      </div>
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

/** Alerta exibido quando o plano não permite (mais) usar o recurso. Não renderiza nada se pode usar. */
export function AvisoLimite({ codigo, className }: { codigo: CodigoRecurso; className?: string }) {
  const { pode, carregando, mensagem } = usePodeUsar(codigo);
  if (pode || carregando || !mensagem) return null;
  return (
    <Alert className={cn('border-warning/40 bg-warning/10', className)}>
      <Sparkles className="size-4" />
      <AlertTitle>Limite do plano</AlertTitle>
      <AlertDescription>
        <p>
          {mensagem}{' '}
          <Link to="/configuracoes" className="font-medium text-primary underline-offset-4 hover:underline">
            Ver meu plano
          </Link>
        </p>
      </AlertDescription>
    </Alert>
  );
}

/** Badge "uso de limite" (ex.: 1 de 1). Para recursos ilimitados mostra "ilimitado". */
export function UsoRecurso({ codigo, className }: { codigo: CodigoRecurso; className?: string }) {
  const { uso, limite, pode, carregando } = usePodeUsar(codigo);
  if (carregando || uso === null) return null;
  return (
    <Badge variant={pode ? 'secondary' : 'destructive'} className={className}>
      {limite === null ? `${uso} · ilimitado` : `${uso} de ${limite}`}
    </Badge>
  );
}

export function SemPermissao() {
  return (
    <EstadoVazio
      icone={<Lock className="size-5" />}
      titulo="Acesso restrito"
      descricao="Seu perfil não tem permissão para acessar esta página. Fale com o administrador da clínica."
    />
  );
}

/** Placeholder das páginas ainda não implementadas (fase 2). */
export function PaginaEmConstrucao({ titulo, descricao }: { titulo: string; descricao?: string }) {
  return (
    <div>
      <CabecalhoPagina titulo={titulo} descricao={descricao} />
      <EstadoVazio
        icone={<Construction className="size-5" />}
        titulo="Em construção"
        descricao="Esta tela será implementada na próxima fase."
      />
    </div>
  );
}
