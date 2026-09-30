// Página PÚBLICA /agendar/:slug (sem login; também abre para quem está logado). Mobile first, passo a passo:
// profissional → dia/horário livre → dados (nome, WhatsApp, e-mail, CPF, nascimento, consentimento, honeypot)
// → "Solicitação enviada! Você receberá a confirmação pelo WhatsApp". Contrato: docs/FASE2.md §2.
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  ArrowLeft,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  MessageCircle,
  Phone,
  Stethoscope,
  UserRound,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useClinicaPublica,
  useDisponibilidadePublica,
  useEnviarSolicitacao,
  type HorarioPublico,
  type ProfissionalPublico,
  type SolicitacaoCriada,
} from '@/api/agendamentoOnline';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { Logo } from '@/componentes/comum';
import { Alert, AlertDescription } from '@/componentes/ui/alert';
import { Button } from '@/componentes/ui/button';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Textarea } from '@/componentes/ui/textarea';
import { mascararCpf, mascararTelefone, somenteDigitos, validarCpf } from '@/lib/formatos';
import { cn } from '@/lib/utils';

// ----------------------------------------------------------------------------- datas (AAAA-MM-DD, sem fuso)

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function partesDia(dia: string) {
  const d = new Date(`${dia}T12:00:00Z`);
  const semana = d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
  return {
    semana: semana.charAt(0).toUpperCase() + semana.slice(1, 3),
    numero: d.getUTCDate(),
    mes: d.toLocaleDateString('pt-BR', { month: 'short', timeZone: 'UTC' }).replace('.', ''),
  };
}

function diaPorExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const t = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', timeZone: 'UTC' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function turnoDaHora(hora: string): 'Manhã' | 'Tarde' | 'Noite' {
  const h = Number(hora.slice(0, 2));
  return h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite';
}

const DIAS_POR_PAGINA = 7;

// ----------------------------------------------------------------------------- página

type Passo = 'profissional' | 'horario' | 'dados' | 'enviado';
const PASSOS: { id: Exclude<Passo, 'enviado'>; rotulo: string }[] = [
  { id: 'profissional', rotulo: 'Profissional' },
  { id: 'horario', rotulo: 'Horário' },
  { id: 'dados', rotulo: 'Seus dados' },
];

export default function PaginaAgendamentoOnline() {
  const { slug = '' } = useParams();
  const { data: info, isLoading, error } = useClinicaPublica(slug);
  const [passo, setPasso] = useState<Passo>('profissional');
  const [profissional, setProfissional] = useState<ProfissionalPublico | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [horario, setHorario] = useState<HorarioPublico | null>(null);
  const [enviada, setEnviada] = useState<SolicitacaoCriada | null>(null);

  if (isLoading) {
    return (
      <Moldura>
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Carregando…
        </div>
      </Moldura>
    );
  }
  if (error || !info) {
    const indisponivel = error instanceof ErroApi && error.status === 404;
    return (
      <Moldura>
        <div className="mx-auto max-w-md px-4 py-20 text-center">
          <div className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
            <CalendarX2 className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">
            {indisponivel ? 'Agendamento online indisponível' : 'Não foi possível carregar a página'}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {indisponivel
              ? 'Este endereço não está aceitando solicitações de agendamento no momento. Entre em contato diretamente com a clínica.'
              : mensagemDeErro(error)}
          </p>
        </div>
      </Moldura>
    );
  }

  const { clinica } = info;
  const local = [clinica.endereco, [clinica.cidade, clinica.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ');
  const indicePasso = passo === 'enviado' ? PASSOS.length : PASSOS.findIndex((p) => p.id === passo);

  return (
    <Moldura>
      {/* Identidade da clínica */}
      <section className="relative overflow-hidden bg-gradient-to-br from-teal-800 via-teal-700 to-cyan-800 text-white">
        <div aria-hidden className="pointer-events-none absolute -top-20 -right-16 size-72 rounded-full bg-white/10 blur-3xl" />
        <div className="relative mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-2xl font-semibold ring-1 ring-white/20">
              {clinica.nome.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium tracking-wide text-white/70 uppercase">Agendamento online</p>
              <h1 className="truncate text-2xl font-semibold tracking-tight">{clinica.nome}</h1>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-1.5 text-sm text-white/85 sm:flex-row sm:flex-wrap sm:gap-x-5">
            {local && (
              <span className="inline-flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-4 shrink-0" /> {local}
              </span>
            )}
            {clinica.telefone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-4" /> {mascararTelefone(clinica.telefone.replace(/^55(?=\d{10,11}$)/, ''))}
              </span>
            )}
          </div>
          {info.mensagem_boas_vindas && passo !== 'enviado' && (
            <p className="mt-4 max-w-2xl text-sm whitespace-pre-line text-white/90">{info.mensagem_boas_vindas}</p>
          )}
        </div>
      </section>

      <div className="relative mx-auto -mt-10 max-w-3xl px-4 pb-16 sm:px-6">
        <div className="rounded-2xl border bg-background shadow-lg shadow-black/5">
          {passo !== 'enviado' && (
            <ol className="flex items-center gap-2 border-b px-4 py-3 sm:px-6">
              {PASSOS.map((p, i) => (
                <li key={p.id} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={cn(
                      'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                      i < indicePasso && 'bg-primary/15 text-primary',
                      i === indicePasso && 'bg-primary text-primary-foreground',
                      i > indicePasso && 'bg-muted text-muted-foreground',
                    )}
                  >
                    {i < indicePasso ? <CheckCircle2 className="size-4" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      'truncate text-xs sm:text-sm',
                      i === indicePasso ? 'font-medium' : 'text-muted-foreground',
                      i !== indicePasso && 'hidden sm:inline',
                    )}
                  >
                    {p.rotulo}
                  </span>
                  {i < PASSOS.length - 1 && <span className="h-px flex-1 bg-border" />}
                </li>
              ))}
            </ol>
          )}

          <div className="p-4 sm:p-6">
            {passo === 'profissional' && (
              <PassoProfissional
                profissionais={info.profissionais}
                selecionado={profissional}
                onEscolher={(p) => {
                  if (p.id !== profissional?.id) {
                    setDia(null);
                    setHorario(null);
                  }
                  setProfissional(p);
                  setPasso('horario');
                }}
              />
            )}
            {passo === 'horario' && profissional && (
              <PassoHorario
                slug={slug}
                hoje={info.hoje}
                diasAFrente={info.dias_a_frente}
                profissional={profissional}
                dia={dia}
                horario={horario}
                onDia={(d) => {
                  setDia(d);
                  setHorario(null);
                }}
                onHorario={(h) => {
                  setHorario(h);
                  setPasso('dados');
                }}
                onVoltar={() => setPasso('profissional')}
              />
            )}
            {passo === 'dados' && profissional && dia && horario && (
              <PassoDados
                slug={slug}
                profissional={profissional}
                dia={dia}
                horario={horario}
                onVoltar={() => setPasso('horario')}
                onHorarioIndisponivel={() => {
                  setHorario(null);
                  setPasso('horario');
                }}
                onEnviada={(s) => {
                  setEnviada(s);
                  setPasso('enviado');
                }}
              />
            )}
            {passo === 'enviado' && enviada && profissional && dia && horario && (
              <PassoEnviado
                clinica={clinica.nome}
                telefoneClinica={clinica.telefone}
                profissional={enviada.profissional.nome || profissional.nome}
                dia={dia}
                hora={horario.hora}
                onNova={() => {
                  setEnviada(null);
                  setHorario(null);
                  setDia(null);
                  setProfissional(null);
                  setPasso('profissional');
                }}
              />
            )}
          </div>
        </div>
      </div>
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <main className="flex-1">{children}</main>
      <footer className="border-t bg-background">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <span>Seus dados são usados apenas para o agendamento, conforme a LGPD.</span>
          <span className="flex items-center gap-1.5">
            Tecnologia <Logo className="scale-75" />
          </span>
        </div>
      </footer>
    </div>
  );
}

// ----------------------------------------------------------------------------- passo 1

function PassoProfissional({
  profissionais,
  selecionado,
  onEscolher,
}: {
  profissionais: ProfissionalPublico[];
  selecionado: ProfissionalPublico | null;
  onEscolher: (p: ProfissionalPublico) => void;
}) {
  if (profissionais.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        Nenhum profissional está disponível para agendamento online no momento. Entre em contato com a clínica.
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-lg font-semibold">Com quem você quer consultar?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Escolha o profissional para ver os horários livres.</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {profissionais.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onEscolher(p)}
              className={cn(
                'group flex w-full items-center gap-3 rounded-xl border p-4 text-left transition hover:border-primary/60 hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                selecionado?.id === p.id && 'border-primary bg-primary/5',
              )}
            >
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <Stethoscope className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.nome}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  {p.especialidade || 'Consulta'} · {p.duracao_consulta_min} min
                </span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ----------------------------------------------------------------------------- passo 2

function PassoHorario({
  slug,
  hoje,
  diasAFrente,
  profissional,
  dia,
  horario,
  onDia,
  onHorario,
  onVoltar,
}: {
  slug: string;
  hoje: string;
  diasAFrente: number;
  profissional: ProfissionalPublico;
  dia: string | null;
  horario: HorarioPublico | null;
  onDia: (d: string) => void;
  onHorario: (h: HorarioPublico) => void;
  onVoltar: () => void;
}) {
  const ultimo = somarDias(hoje, diasAFrente);
  const totalDias = diasAFrente + 1;
  const [pagina, setPagina] = useState(() =>
    dia ? Math.floor((new Date(`${dia}T12:00:00Z`).getTime() - new Date(`${hoje}T12:00:00Z`).getTime()) / 86_400_000 / DIAS_POR_PAGINA) : 0,
  );
  const dias = useMemo(
    () =>
      Array.from({ length: DIAS_POR_PAGINA }, (_, i) => somarDias(hoje, pagina * DIAS_POR_PAGINA + i)).filter((d) => d <= ultimo),
    [hoje, pagina, ultimo],
  );
  const totalPaginas = Math.ceil(totalDias / DIAS_POR_PAGINA);
  const { data, isFetching, isError, refetch } = useDisponibilidadePublica(slug, profissional.id, dia);

  const grupos = useMemo(() => {
    const g: Record<string, HorarioPublico[]> = {};
    for (const h of data?.horarios ?? []) (g[turnoDaHora(h.hora)] ??= []).push(h);
    return (['Manhã', 'Tarde', 'Noite'] as const).filter((t) => g[t]?.length).map((t) => ({ turno: t, horarios: g[t]! }));
  }, [data]);

  return (
    <div>
      <button
        type="button"
        onClick={onVoltar}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {profissional.nome}
      </button>
      <h2 className="text-lg font-semibold">Escolha o dia e o horário</h2>

      <div className="mt-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Dias anteriores"
          disabled={pagina === 0}
          onClick={() => setPagina((p) => p - 1)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <div className="grid flex-1 grid-cols-7 gap-1.5">
          {dias.map((d) => {
            const p = partesDia(d);
            const ativo = d === dia;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onDia(d)}
                aria-pressed={ativo}
                className={cn(
                  'flex flex-col items-center rounded-lg border py-2 text-center transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  ativo && 'border-primary bg-primary text-primary-foreground hover:border-primary',
                )}
              >
                <span className={cn('text-[11px]', ativo ? 'text-primary-foreground/80' : 'text-muted-foreground')}>
                  {d === hoje ? 'Hoje' : p.semana}
                </span>
                <span className="text-base leading-tight font-semibold">{p.numero}</span>
                <span className={cn('text-[11px]', ativo ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{p.mes}</span>
              </button>
            );
          })}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Próximos dias"
          disabled={pagina >= totalPaginas - 1}
          onClick={() => setPagina((p) => p + 1)}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>

      <div className="mt-6 min-h-40">
        {!dia && (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <CalendarDays className="size-4" /> Selecione um dia para ver os horários.
          </p>
        )}
        {dia && isFetching && !data && (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Buscando horários…
          </p>
        )}
        {dia && isError && (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Não foi possível carregar os horários.{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => refetch()}>
              Tentar de novo
            </button>
          </div>
        )}
        {dia && data && grupos.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum horário livre em {diaPorExtenso(dia).toLowerCase()}. Tente outro dia.
          </p>
        )}
        {dia && data && grupos.length > 0 && (
          <div className={cn('space-y-5', isFetching && 'opacity-60')}>
            <p className="text-sm font-medium">{diaPorExtenso(dia)}</p>
            {grupos.map((g) => (
              <div key={g.turno}>
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{g.turno}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {g.horarios.map((h) => (
                    <button
                      key={h.inicio}
                      type="button"
                      onClick={() => onHorario(h)}
                      className={cn(
                        'rounded-lg border py-2.5 text-sm font-medium tabular-nums transition hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        horario?.inicio === h.inicio && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {h.hora}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------- passo 3

const esquemaDados = z.object({
  nome: z.string().trim().min(3, 'Informe seu nome completo'),
  telefone: z.string().refine((t) => {
    const n = somenteDigitos(t).length;
    return n >= 10 && n <= 11;
  }, 'Informe o WhatsApp com DDD'),
  email: z.union([z.literal(''), z.email('E-mail inválido')]),
  cpf: z.string().refine((v) => !v || validarCpf(v), 'CPF inválido'),
  nascimento: z.string(),
  observacoes: z.string().max(1000, 'Máximo de 1000 caracteres'),
  aceita_whatsapp: z.boolean(),
  website: z.string(),
});
type DadosForm = z.infer<typeof esquemaDados>;

function PassoDados({
  slug,
  profissional,
  dia,
  horario,
  onVoltar,
  onHorarioIndisponivel,
  onEnviada,
}: {
  slug: string;
  profissional: ProfissionalPublico;
  dia: string;
  horario: HorarioPublico;
  onVoltar: () => void;
  onHorarioIndisponivel: () => void;
  onEnviada: (s: SolicitacaoCriada) => void;
}) {
  const enviar = useEnviarSolicitacao(slug);
  const [erro, setErro] = useState<string | null>(null);
  const form = useForm<DadosForm>({
    resolver: zodResolver(esquemaDados),
    defaultValues: {
      nome: '',
      telefone: '',
      email: '',
      cpf: '',
      nascimento: '',
      observacoes: '',
      aceita_whatsapp: true,
      website: '',
    },
  });
  const aceita = form.watch('aceita_whatsapp');

  async function submeter(d: DadosForm) {
    setErro(null);
    try {
      const r = await enviar.mutateAsync({
        profissional_id: profissional.id,
        inicio: horario.inicio,
        nome: d.nome.trim(),
        telefone: somenteDigitos(d.telefone),
        email: d.email || null,
        cpf: d.cpf ? somenteDigitos(d.cpf) : null,
        nascimento: d.nascimento || null,
        observacoes: d.observacoes.trim() || null,
        aceita_whatsapp: d.aceita_whatsapp,
        website: d.website,
      });
      onEnviada(r);
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'horario_indisponivel') {
        toast.error('Este horário acabou de ser ocupado.', { description: 'Escolha outro horário, por favor.' });
        onHorarioIndisponivel();
        return;
      }
      if (e instanceof ErroApi && e.status === 429) {
        setErro('Muitas tentativas em pouco tempo. Aguarde um minuto e tente novamente.');
        return;
      }
      setErro(mensagemDeErro(e));
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onVoltar}
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Trocar horário
      </button>
      <h2 className="text-lg font-semibold">Seus dados</h2>

      <div className="mt-4 flex flex-col gap-2 rounded-xl bg-muted/60 p-4 text-sm sm:flex-row sm:items-center sm:gap-5">
        <span className="inline-flex items-center gap-2 font-medium">
          <UserRound className="size-4 text-primary" /> {profissional.nome}
        </span>
        <span className="inline-flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" /> {diaPorExtenso(dia)}
        </span>
        <span className="inline-flex items-center gap-2">
          <Clock className="size-4 text-primary" /> {horario.hora}
        </span>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(submeter)} className="mt-5 space-y-4" noValidate>
          {/* Honeypot: invisível para pessoas; robôs costumam preencher. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label>
              Website
              <input tabIndex={-1} autoComplete="off" {...form.register('website')} />
            </label>
          </div>

          <FormField
            control={form.control}
            name="nome"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nome completo</FormLabel>
                <FormControl>
                  <Input autoComplete="name" autoFocus {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="telefone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>WhatsApp</FormLabel>
                  <FormControl>
                    <Input
                      inputMode="tel"
                      autoComplete="tel-national"
                      placeholder="(11) 99999-9999"
                      {...field}
                      onChange={(e) => field.onChange(mascararTelefone(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    E-mail <span className="font-normal text-muted-foreground">(opcional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="cpf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    CPF <span className="font-normal text-muted-foreground">(opcional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      {...field}
                      onChange={(e) => field.onChange(mascararCpf(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="nascimento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    Data de nascimento <span className="font-normal text-muted-foreground">(opcional)</span>
                  </FormLabel>
                  <FormControl>
                    <Input type="date" max={new Date().toISOString().slice(0, 10)} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="observacoes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Observações <span className="font-normal text-muted-foreground">(opcional)</span>
                </FormLabel>
                <FormControl>
                  <Textarea rows={3} placeholder="Ex.: primeira consulta, convênio, motivo da consulta…" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="aceita_whatsapp"
            render={({ field }) => (
              <FormItem className="rounded-xl border p-4">
                <div className="flex items-start gap-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} className="mt-0.5" />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel className="leading-snug font-medium">
                      Aceito receber mensagens da clínica pelo WhatsApp
                    </FormLabel>
                    <p className="text-xs text-muted-foreground">
                      Usamos o WhatsApp para enviar a confirmação do agendamento e lembretes da consulta.
                    </p>
                  </div>
                </div>
                {!aceita && (
                  <p className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs">
                    Sem essa autorização você não receberá a confirmação pelo WhatsApp — a clínica entrará em contato de
                    outra forma.
                  </p>
                )}
              </FormItem>
            )}
          />

          {erro && (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{erro}</p>
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" size="lg" className="w-full" disabled={enviar.isPending}>
            {enviar.isPending && <Loader2 className="size-4 animate-spin" />}
            Solicitar agendamento
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            O horário fica reservado para você até a clínica confirmar a solicitação.
          </p>
        </form>
      </Form>
    </div>
  );
}

// ----------------------------------------------------------------------------- passo 4

function PassoEnviado({
  clinica,
  telefoneClinica,
  profissional,
  dia,
  hora,
  onNova,
}: {
  clinica: string;
  telefoneClinica: string | null;
  profissional: string;
  dia: string;
  hora: string;
  onNova: () => void;
}) {
  return (
    <div className="py-6 text-center">
      <div className="mx-auto grid size-16 place-items-center rounded-full bg-success/15 text-success">
        <CheckCircle2 className="size-8" />
      </div>
      <h2 className="mt-4 text-xl font-semibold">Solicitação enviada!</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        A {clinica} vai analisar o seu pedido. <strong className="text-foreground">Você receberá a confirmação pelo WhatsApp</strong>{' '}
        assim que o horário for aprovado.
      </p>
      <div className="mx-auto mt-6 max-w-sm space-y-2 rounded-xl border p-4 text-left text-sm">
        <p className="flex items-center gap-2">
          <UserRound className="size-4 text-primary" /> {profissional}
        </p>
        <p className="flex items-center gap-2">
          <CalendarDays className="size-4 text-primary" /> {diaPorExtenso(dia)}
        </p>
        <p className="flex items-center gap-2">
          <Clock className="size-4 text-primary" /> {hora}
        </p>
        <p className="flex items-center gap-2 text-muted-foreground">
          <MessageCircle className="size-4" /> Aguardando confirmação da clínica
        </p>
      </div>
      {telefoneClinica && (
        <p className="mt-4 text-xs text-muted-foreground">
          Dúvidas? Fale com a clínica: {mascararTelefone(telefoneClinica.replace(/^55(?=\d{10,11}$)/, ''))}
        </p>
      )}
      <Button variant="outline" className="mt-6" onClick={onNova}>
        Fazer outra solicitação
      </Button>
    </div>
  );
}
