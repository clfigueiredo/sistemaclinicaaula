// Onboarding pós-cadastro: checklist com os primeiros passos (seção 5 da arquitetura).
// Os passos são marcados como concluídos a partir do uso reportado por /me.
// Pode ser refinado na fase 2 (ex.: verificar grade de horários e convênios cadastrados).
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, CheckCircle2, Circle, MessageCircle, ShieldCheck, Stethoscope } from 'lucide-react';
import { useMe } from '@/api/me';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent } from '@/componentes/ui/card';
import { cn } from '@/lib/utils';

export default function PaginaOnboarding() {
  const { data: me } = useMe();
  if (!me) return <Carregando />;

  const passos = [
    {
      titulo: 'Cadastre um profissional',
      descricao: 'Médico, dentista, psicólogo… quem atende na clínica.',
      icone: Stethoscope,
      para: '/profissionais',
      feito: (me.recursos.max_profissionais.uso ?? 0) > 0,
    },
    {
      titulo: 'Defina a grade de horários',
      descricao: 'Dias e horários de atendimento de cada profissional.',
      icone: CalendarClock,
      para: '/profissionais',
      feito: false,
    },
    {
      titulo: 'Cadastre os convênios',
      descricao: 'Os planos de saúde que a clínica aceita (opcional).',
      icone: ShieldCheck,
      para: '/convenios',
      feito: false,
    },
    {
      titulo: 'Conecte o WhatsApp',
      descricao: 'Para enviar lembretes e confirmar consultas automaticamente.',
      icone: MessageCircle,
      para: '/whatsapp',
      feito: false,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <CabecalhoPagina
        titulo={`Bem-vindo(a), ${me.usuario.nome.split(' ')[0]}!`}
        descricao={`Vamos deixar a ${me.clinica.nome} pronta para atender. São só alguns passos.`}
      />
      <div className="space-y-3">
        {passos.map((p, i) => (
          <Card key={p.titulo} className={cn('py-0 transition-colors', p.feito && 'bg-muted/40')}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <p.icone className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.feito ? (
                    <CheckCircle2 className="size-4 text-success" />
                  ) : (
                    <Circle className="size-4 text-muted-foreground" />
                  )}
                  {i + 1}. {p.titulo}
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{p.descricao}</p>
              </div>
              <Button asChild variant={p.feito ? 'ghost' : 'outline'} size="sm">
                <Link to={p.para}>
                  {p.feito ? 'Ver' : 'Começar'}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-8 flex justify-end">
        <Button asChild>
          <Link to="/agenda">Ir para a agenda</Link>
        </Button>
      </div>
    </div>
  );
}
