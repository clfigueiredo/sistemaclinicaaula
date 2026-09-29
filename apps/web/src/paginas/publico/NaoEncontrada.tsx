import { Link } from 'react-router-dom';
import { Logo } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';

export default function PaginaNaoEncontrada() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <p className="mt-6 text-5xl font-semibold text-primary">404</p>
      <p className="text-muted-foreground">A página que você procura não existe.</p>
      <Button asChild variant="outline">
        <Link to="/">Voltar ao início</Link>
      </Button>
    </div>
  );
}
