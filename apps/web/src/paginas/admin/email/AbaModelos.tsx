/**
 * Aba "Modelos": textos dos 5 e-mails automáticos. Lista à esquerda; editor com variáveis clicáveis,
 * pré-visualização (renderizada pela API, num iframe sem scripts) e envio de teste à direita.
 */
import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, RotateCcw, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import {
  usePreviaModeloEmail,
  useModelosEmail,
  useRestaurarModeloEmail,
  useSalvarModeloEmail,
  useTesteModeloEmail,
  type ModeloEmail,
  type PreviaEmail,
  type TipoEmail,
} from '@/api/adminEmail';
import { mensagemDeErro } from '@/api/cliente';
import { useAdminMe } from '@/api/me';
import { Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Separator } from '@/componentes/ui/separator';
import { Switch } from '@/componentes/ui/switch';
import { Textarea } from '@/componentes/ui/textarea';
import { formatarDataHora } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import { DialogoConfirmacao, ErroCarregar } from '../comum';

const ATRASO_PREVIA_MS = 500;
const LIMITES = { assunto: 200, corpo: 10_000, texto_botao: 60 } as const;
type CampoTexto = keyof typeof LIMITES;

export default function AbaModelos() {
  const { data, isLoading, isError, error, refetch } = useModelosEmail();
  const [selecionado, setSelecionado] = useState<TipoEmail | null>(null);

  if (isLoading) return <Carregando />;
  if (isError || !data) return <ErroCarregar mensagem={mensagemDeErro(error)} aoTentar={() => refetch()} />;

  const modelo = data.find((m) => m.tipo === selecionado) ?? data[0]!;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="space-y-2" role="list" aria-label="Modelos de e-mail">
        {data.map((m) => (
          <ItemModelo key={m.tipo} modelo={m} selecionado={m.tipo === modelo.tipo} aoSelecionar={() => setSelecionado(m.tipo)} />
        ))}
      </div>
      <EditorModelo key={`${modelo.tipo}-${modelo.personalizado ? 'personalizado' : 'padrao'}`} modelo={modelo} />
    </div>
  );
}

function BadgeOrigem({ personalizado }: { personalizado: boolean }) {
  return personalizado ? (
    <Badge variant="outline" className="border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300">
      Personalizado
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      Padrão
    </Badge>
  );
}

function ItemModelo({ modelo, selecionado, aoSelecionar }: { modelo: ModeloEmail; selecionado: boolean; aoSelecionar: () => void }) {
  const salvar = useSalvarModeloEmail();

  function alternarAtivo(ativo: boolean) {
    salvar.mutate(
      { tipo: modelo.tipo, assunto: modelo.assunto, corpo: modelo.corpo, texto_botao: modelo.texto_botao, ativo },
      {
        onSuccess: () => toast.success(ativo ? `"${modelo.nome}" ligado.` : `"${modelo.nome}" desligado: esse e-mail não será enviado.`),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  return (
    <div
      role="listitem"
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-card p-3 transition-colors',
        selecionado ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/50',
      )}
    >
      <button
        type="button"
        onClick={aoSelecionar}
        aria-current={selecionado}
        className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <p className="text-sm font-medium">{modelo.nome}</p>
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{modelo.descricao}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <BadgeOrigem personalizado={modelo.personalizado} />
          {!modelo.ativo && (
            <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
              Desligado
            </Badge>
          )}
        </div>
      </button>
      <Switch
        checked={modelo.ativo}
        disabled={!modelo.desligavel || salvar.isPending}
        onCheckedChange={alternarAtivo}
        aria-label={`Envio de "${modelo.nome}"`}
        title={modelo.desligavel ? undefined : 'Este e-mail não pode ser desligado'}
      />
    </div>
  );
}

/** Pré-visualização com debounce; ignora respostas antigas. */
function usePreviaComAtraso(tipo: TipoEmail, assunto: string, corpo: string, textoBotao: string) {
  const previa = usePreviaModeloEmail();
  const mutar = previa.mutate;
  const [resultado, setResultado] = useState<PreviaEmail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const sequencia = useRef(0);

  useEffect(() => {
    const id = ++sequencia.current;
    const timer = setTimeout(() => {
      mutar(
        { tipo, assunto, corpo, texto_botao: textoBotao },
        {
          onSuccess: (r) => {
            if (id !== sequencia.current) return;
            setResultado(r);
            setErro(null);
          },
          onError: (e) => {
            if (id === sequencia.current) setErro(mensagemDeErro(e));
          },
        },
      );
    }, ATRASO_PREVIA_MS);
    return () => clearTimeout(timer);
  }, [tipo, assunto, corpo, textoBotao, mutar]);

  return { resultado, erro, carregando: previa.isPending };
}

function EditorModelo({ modelo }: { modelo: ModeloEmail }) {
  const salvar = useSalvarModeloEmail();
  const restaurar = useRestaurarModeloEmail();
  const teste = useTesteModeloEmail();
  const { data: adminMe } = useAdminMe();

  const [textos, setTextos] = useState<Record<CampoTexto, string>>({
    assunto: modelo.assunto,
    corpo: modelo.corpo,
    texto_botao: modelo.texto_botao,
  });
  const [ativo, setAtivo] = useState(modelo.ativo);
  const [paraTeste, setParaTeste] = useState('');
  const [confirmarRestaurar, setConfirmarRestaurar] = useState(false);
  const ultimoCampo = useRef<CampoTexto>('corpo');
  const refs = {
    assunto: useRef<HTMLInputElement>(null),
    corpo: useRef<HTMLTextAreaElement>(null),
    texto_botao: useRef<HTMLInputElement>(null),
  };

  const { resultado: previa, erro: erroPrevia, carregando: carregandoPrevia } = usePreviaComAtraso(
    modelo.tipo,
    textos.assunto,
    textos.corpo,
    textos.texto_botao,
  );

  const alterado =
    textos.assunto !== modelo.assunto ||
    textos.corpo !== modelo.corpo ||
    textos.texto_botao !== modelo.texto_botao ||
    ativo !== modelo.ativo;
  const vazio = (Object.keys(LIMITES) as CampoTexto[]).find((c) => !textos[c].trim());
  const destinoTeste = paraTeste || adminMe?.usuario.email || '';

  function mudar(campo: CampoTexto, valor: string) {
    setTextos((t) => ({ ...t, [campo]: valor }));
  }

  /** Insere `{nome}` na posição do cursor do último campo usado (padrão: corpo). */
  function inserirVariavel(nome: string) {
    const campo = ultimoCampo.current;
    const el = refs[campo].current;
    const marcador = `{${nome}}`;
    const atual = textos[campo];
    const inicio = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    const novo = `${atual.slice(0, inicio)}${marcador}${atual.slice(fim)}`.slice(0, LIMITES[campo]);
    mudar(campo, novo);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const pos = inicio + marcador.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function aoSalvar() {
    salvar.mutate(
      { tipo: modelo.tipo, ...textos, ativo },
      {
        onSuccess: () => toast.success('Modelo salvo. Os próximos e-mails usam este texto.'),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  function aoRestaurar() {
    restaurar.mutate(modelo.tipo, {
      onSuccess: () => {
        toast.success('Texto padrão restaurado.');
        setConfirmarRestaurar(false);
      },
      onError: (e) => toast.error(mensagemDeErro(e)),
    });
  }

  function aoEnviarTeste() {
    teste.mutate(
      { tipo: modelo.tipo, para: destinoTeste, ...textos },
      {
        onSuccess: () => toast.success(`Teste enviado para ${destinoTeste}.`),
        onError: (e) => toast.error(mensagemDeErro(e)),
      },
    );
  }

  const campoProps = (campo: CampoTexto) => ({
    value: textos[campo],
    maxLength: LIMITES[campo],
    onFocus: () => {
      ultimoCampo.current = campo;
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {modelo.nome} <BadgeOrigem personalizado={modelo.personalizado} />
        </CardTitle>
        <CardDescription>
          {modelo.descricao}
          {modelo.atualizado_em && ` Editado em ${formatarDataHora(modelo.atualizado_em)}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 2xl:grid-cols-2">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="modelo-assunto">Assunto</Label>
              <Input id="modelo-assunto" ref={refs.assunto} {...campoProps('assunto')} onChange={(e) => mudar('assunto', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="modelo-corpo">Corpo</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {textos.corpo.length.toLocaleString('pt-BR')} / {LIMITES.corpo.toLocaleString('pt-BR')}
                </span>
              </div>
              <Textarea
                id="modelo-corpo"
                ref={refs.corpo}
                rows={14}
                className="font-mono text-sm"
                {...campoProps('corpo')}
                onChange={(e) => mudar('corpo', e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Linha em branco separa parágrafos · <code className="rounded bg-muted px-1">**texto**</code> fica em negrito ·
                linhas começando com <code className="rounded bg-muted px-1">- </code> viram lista.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="modelo-botao">Texto do botão</Label>
                <Input
                  id="modelo-botao"
                  ref={refs.texto_botao}
                  {...campoProps('texto_botao')}
                  onChange={(e) => mudar('texto_botao', e.target.value)}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-sm" title={modelo.desligavel ? undefined : 'Este e-mail não pode ser desligado'}>
                <Switch checked={ativo} disabled={!modelo.desligavel} onCheckedChange={setAtivo} />
                Ativo
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              O botão leva para <code className="rounded bg-muted px-1">{`{${modelo.variavelLink}}`}</code>.
            </p>

            <div className="space-y-2">
              <p className="text-sm font-medium">Variáveis</p>
              <p className="text-xs text-muted-foreground">Clique para inserir no campo onde está o cursor.</p>
              <ul className="space-y-1">
                {modelo.variaveis.map((v) => (
                  <li key={v.nome} className="flex items-baseline gap-2 text-sm">
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => inserirVariavel(v.nome)}
                      className="shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-xs hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {`{${v.nome}}`}
                    </button>
                    <span className="text-xs text-muted-foreground">
                      {v.descricao} <span className="opacity-70">— ex.: {v.exemplo}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Pré-visualização</p>
              {carregandoPrevia && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Atualizando" />}
            </div>
            <div className="rounded-lg border">
              <div className="border-b bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Assunto: </span>
                <span className="font-medium">{previa?.assunto || '—'}</span>
              </div>
              {previa ? (
                <iframe
                  title="Pré-visualização do e-mail"
                  sandbox=""
                  srcDoc={previa.html}
                  className="h-[32rem] w-full rounded-b-lg bg-white"
                />
              ) : (
                <div className="grid h-[32rem] place-items-center text-sm text-muted-foreground">{erroPrevia ?? 'Gerando…'}</div>
              )}
            </div>
            {erroPrevia && previa && <p className="text-xs text-destructive">{erroPrevia}</p>}
            <p className="text-xs text-muted-foreground">Com valores de exemplo. O layout (cabeçalho, botão e rodapé) é fixo.</p>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5 sm:max-w-xs">
              <Label htmlFor="modelo-teste-para">Enviar teste para</Label>
              <Input
                id="modelo-teste-para"
                type="email"
                value={paraTeste}
                placeholder={adminMe?.usuario.email ?? 'seu@email.com'}
                onChange={(e) => setParaTeste(e.target.value)}
              />
            </div>
            <Button type="button" variant="outline" onClick={aoEnviarTeste} disabled={!destinoTeste || !!vazio || teste.isPending}>
              {teste.isPending ? <Loader2 className="animate-spin" /> : <Send />}
              Enviar teste para mim
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={() => setConfirmarRestaurar(true)} disabled={!modelo.personalizado}>
              <RotateCcw /> Restaurar texto padrão
            </Button>
            <Button type="button" onClick={aoSalvar} disabled={!alterado || !!vazio || salvar.isPending}>
              {salvar.isPending ? <Loader2 className="animate-spin" /> : alterado ? <Save /> : <CheckCircle2 />}
              {alterado ? 'Salvar' : 'Salvo'}
            </Button>
          </div>
        </div>
        {vazio && <p className="text-right text-xs text-destructive">Preencha assunto, corpo e texto do botão.</p>}
      </CardContent>

      <DialogoConfirmacao
        aberto={confirmarRestaurar}
        aoMudar={setConfirmarRestaurar}
        titulo="Restaurar o texto padrão?"
        descricao="O texto personalizado deste e-mail será apagado e o sistema volta a usar o texto padrão. Não dá para desfazer."
        textoConfirmar="Restaurar padrão"
        perigo
        carregando={restaurar.isPending}
        aoConfirmar={aoRestaurar}
      />
    </Card>
  );
}
