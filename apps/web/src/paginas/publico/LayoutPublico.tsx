import type { ReactNode } from 'react';
import { CalendarCheck, FileLock2, MessageCircle } from 'lucide-react';
import { Logo } from '@/componentes/comum';

const DESTAQUES = [
  { icone: CalendarCheck, texto: 'Agenda por profissional, com grade de horários e bloqueios' },
  { icone: FileLock2, texto: 'Prontuário seguro, imutável e com registro de acesso (LGPD)' },
  { icone: MessageCircle, texto: 'Lembretes e confirmações automáticas pelo WhatsApp' },
];

/** Layout das páginas públicas: painel da marca à esquerda (desktop) + formulário. */
export function LayoutPublico({
  titulo,
  subtitulo,
  children,
  rodape,
  largo = false,
}: {
  titulo: string;
  subtitulo?: ReactNode;
  children: ReactNode;
  rodape?: ReactNode;
  largo?: boolean;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-teal-800 via-teal-700 to-cyan-800 p-10 text-white lg:flex lg:flex-col">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-80 rounded-full bg-cyan-300/10 blur-3xl"
        />
        <Logo claro />
        <div className="relative my-auto max-w-md">
          <h2 className="text-3xl leading-tight font-semibold">A gestão da sua clínica, simples e em um só lugar.</h2>
          <ul className="mt-8 space-y-4">
            {DESTAQUES.map(({ icone: Icone, texto }) => (
              <li key={texto} className="flex items-start gap-3 text-sm text-white/85">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/10">
                  <Icone className="size-4" />
                </span>
                <span className="pt-1.5">{texto}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/60">© {new Date().getFullYear()} Sistema Clínica</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className={largo ? 'w-full max-w-lg' : 'w-full max-w-sm'}>
          <Logo className="mb-8 lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {subtitulo && <p className="mt-1.5 text-sm text-muted-foreground">{subtitulo}</p>}
          <div className="mt-8">{children}</div>
          {rodape && <div className="mt-6 text-center text-sm text-muted-foreground">{rodape}</div>}
        </div>
      </main>
    </div>
  );
}
