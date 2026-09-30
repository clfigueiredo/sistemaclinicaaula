/**
 * Sino de avisos no topo do app da clínica (admin e recepção, quando o recurso WhatsApp está
 * habilitado no plano). Mostra os cancelamentos feitos pelos pacientes respondendo "2" ao
 * lembrete. Contador de não lidos com polling de 60 s (useAvisosWhatsapp).
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CalendarClock, Check, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { mensagemDeErro } from '@/api/cliente';
import { useAvisosWhatsapp, useMarcarAvisoLido } from '@/api/whatsapp';
import { Button } from '@/componentes/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/componentes/ui/popover';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';

export function SinoAvisos() {
  const [aberto, setAberto] = useState(false);
  const { data, isLoading } = useAvisosWhatsapp();
  const marcar = useMarcarAvisoLido();
  const naoLidos = data?.nao_lidos ?? 0;

  function marcarLido(id: string) {
    marcar.mutate(id, {
      onError: (e) => toast.error('Não foi possível marcar como lido', { description: mensagemDeErro(e) }),
    });
  }

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={naoLidos ? `Avisos: ${naoLidos} não lido(s)` : 'Avisos'}
          title="Avisos"
        >
          <Bell className="size-5" />
          {naoLidos > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {naoLidos > 99 ? '99+' : naoLidos}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <p className="text-sm font-medium">Avisos</p>
            <p className="text-xs text-muted-foreground">Cancelamentos feitos pelos pacientes no WhatsApp.</p>
          </div>
          {naoLidos > 0 && (
            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
              {naoLidos} novo(s)
            </span>
          )}
        </div>
        {isLoading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : !data?.itens.length ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum aviso por enquanto.</p>
        ) : (
          <ul className="max-h-[min(24rem,60vh)] divide-y overflow-y-auto">
            {data.itens.map((a) => (
              <li key={a.id} className={cn('flex items-start gap-3 px-4 py-3', a.lido && 'opacity-60')}>
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.lido ? 'bg-muted-foreground/40' : 'bg-destructive')}
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm break-words">{a.conteudo}</p>
                  <p className="text-xs text-muted-foreground">{formatarDataHora(a.criado_em)}</p>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {a.agendamento && (
                      <Link
                        to={`/agenda?agendamento=${a.agendamento.id}`}
                        onClick={() => setAberto(false)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <CalendarClock className="size-3.5" /> Ver agendamento
                      </Link>
                    )}
                    {a.paciente && (
                      <Link
                        to={`/pacientes/${a.paciente.id}`}
                        onClick={() => setAberto(false)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <User className="size-3.5" /> {a.paciente.nome}
                      </Link>
                    )}
                  </div>
                </div>
                {!a.lido && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 shrink-0"
                    title="Marcar como lido"
                    aria-label="Marcar como lido"
                    disabled={marcar.isPending}
                    onClick={() => marcarLido(a.id)}
                  >
                    <Check className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
