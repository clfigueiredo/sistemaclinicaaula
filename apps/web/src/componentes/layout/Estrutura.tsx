/** Estrutura visual compartilhada pelos layouts (sidebar + topo + conteúdo). */
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Logo } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/componentes/ui/sheet';
import { Avatar, AvatarFallback } from '@/componentes/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/componentes/ui/dropdown-menu';
import type { ItemMenu } from '@/rotas/navegacao';

function iniciais(nome: string) {
  return nome
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function Navegacao({ itens, aoNavegar }: { itens: ItemMenu[]; aoNavegar?: () => void }) {
  return (
    <nav className="flex flex-col gap-0.5">
      {itens.map((item) => (
        <NavLink
          key={item.caminho}
          to={item.caminho}
          end={item.caminho === '/admin'}
          onClick={aoNavegar}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
            )
          }
        >
          <item.icone className="size-4 shrink-0" />
          {item.rotulo}
        </NavLink>
      ))}
    </nav>
  );
}

export function Estrutura({
  itens,
  subtitulo,
  rodapeSidebar,
  usuario,
  aoSair,
  aviso,
  acoesTopo,
  children,
}: {
  itens: ItemMenu[];
  subtitulo?: ReactNode;
  rodapeSidebar?: ReactNode;
  usuario: { nome: string; detalhe?: string };
  aoSair: () => void;
  aviso?: ReactNode;
  /** Ações extras no topo, à esquerda do menu do usuário (ex.: sino de avisos). */
  acoesTopo?: ReactNode;
  children: ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);
  const location = useLocation();
  const atual = itens.find((i) =>
    i.caminho === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(i.caminho),
  );

  const conteudoSidebar = (aoNavegar?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-5 pb-4">
        <Logo />
        {subtitulo && <div className="mt-3 truncate text-xs text-muted-foreground">{subtitulo}</div>}
      </div>
      <div className="flex-1 overflow-y-auto px-3">
        <Navegacao itens={itens} aoNavegar={aoNavegar} />
      </div>
      {rodapeSidebar && <div className="border-t border-sidebar-border p-4">{rodapeSidebar}</div>}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-sidebar-border bg-sidebar lg:block">
        {conteudoSidebar()}
      </aside>

      <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
        <SheetContent side="left" className="w-72 bg-sidebar p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Menu</SheetTitle>
          </SheetHeader>
          {conteudoSidebar(() => setMenuAberto(false))}
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur sm:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMenuAberto(true)}
            aria-label="Abrir menu"
          >
            <Menu className="size-5" />
          </Button>
          <span className="truncate text-sm font-medium text-muted-foreground">{atual?.rotulo}</span>
          <div className="ml-auto flex items-center gap-1">
            {acoesTopo}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-2">
                  <Avatar className="size-7">
                    <AvatarFallback className="bg-primary/10 text-xs text-primary">
                      {iniciais(usuario.nome)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-40 truncate text-sm sm:inline">{usuario.nome}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="truncate text-sm font-medium">{usuario.nome}</div>
                  {usuario.detalhe && <div className="truncate text-xs text-muted-foreground">{usuario.detalhe}</div>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={aoSair}>
                  <LogOut className="size-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        {aviso}
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
