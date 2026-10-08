// Criação/edição de plano: dados (nome, descrição, preço, situação, plano de cadastro) e matriz de
// recursos (habilitado, limite ou ilimitado, período total/mensal). useParams().id — "novo" para criar.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch, type Control } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Infinity as IconeInfinito, Loader2, Save, Star, Trash2 } from 'lucide-react';
import {
  useCatalogoRecursos,
  useCriarPlano,
  useEditarPlano,
  useExcluirPlano,
  usePlano,
  type DadosPlano,
  type Plano,
  type RecursoCatalogo,
} from '@/api/adminPlanos';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import type { CodigoRecurso } from '@/api/tipos';
import { CabecalhoPagina, Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/componentes/ui/form';
import { Input } from '@/componentes/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/componentes/ui/select';
import { Switch } from '@/componentes/ui/switch';
import { Textarea } from '@/componentes/ui/textarea';
import { cn } from '@/lib/utils';
import { BadgeSituacao, DialogoConfirmacao, ErroCarregar } from '../comum';

// ----------------------------------------------------------------------------- formulário

const esquemaRecurso = z
  .object({
    codigo: z.string(),
    tipo: z.enum(['limite', 'booleano']),
    habilitado: z.boolean(),
    ilimitado: z.boolean(),
    limite: z.string(),
    periodo: z.enum(['total', 'mensal']),
  })
  .superRefine((r, ctx) => {
    if (r.tipo !== 'limite' || !r.habilitado || r.ilimitado) return;
    const n = Number(r.limite);
    if (r.limite.trim() === '' || !Number.isInteger(n) || n < 0) {
      ctx.addIssue({ code: 'custom', path: ['limite'], message: 'Informe um número inteiro (0 ou mais)' });
    }
  });

const esquema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome do plano (mín. 2 caracteres)').max(80, 'Nome muito longo'),
  descricao: z.string().trim().max(500, 'Descrição muito longa'),
  preco: z.string().refine((v) => {
    const n = converterPreco(v);
    return n !== null && n >= 0 && n <= 1_000_000;
  }, 'Preço inválido (ex.: 149,90)'),
  ativo: z.boolean(),
  plano_cadastro: z.boolean(),
  contratavel: z.boolean(),
  exibir_landing: z.boolean(),
  recursos: z.array(esquemaRecurso),
});
type Dados = z.infer<typeof esquema>;
type LinhaRecurso = Dados['recursos'][number];

function converterPreco(v: string): number | null {
  const limpo = v.trim().replace(/\s|R\$/g, '');
  if (!limpo) return 0;
  // Aceita "1.234,56", "1234,56" e "1234.56".
  const normalizado = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  if (!/^\d+(\.\d{1,2})?$/.test(normalizado)) return null;
  return Number(normalizado);
}

function valoresIniciais(catalogo: RecursoCatalogo[], plano?: Plano): Dados {
  return {
    nome: plano?.nome ?? '',
    descricao: plano?.descricao ?? '',
    preco: plano ? Number(plano.preco).toFixed(2).replace('.', ',') : '0,00',
    ativo: plano?.ativo ?? true,
    plano_cadastro: plano?.plano_cadastro ?? false,
    contratavel: plano?.contratavel ?? false,
    exibir_landing: plano?.exibir_landing ?? false,
    recursos: catalogo.map((c) => {
      const r = plano?.recursos.find((x) => x.codigo === c.codigo);
      return {
        codigo: c.codigo,
        tipo: c.tipo,
        habilitado: r?.habilitado ?? false,
        ilimitado: c.tipo === 'limite' ? (r ? r.limite === null : false) : true,
        limite: r?.limite != null ? String(r.limite) : '1',
        periodo: r?.periodo ?? 'total',
      };
    }),
  };
}

function paraApi(d: Dados): DadosPlano {
  return {
    nome: d.nome,
    descricao: d.descricao || null,
    preco: converterPreco(d.preco) ?? 0,
    ativo: d.ativo,
    plano_cadastro: d.plano_cadastro,
    // Plano gratuito não é contratável (a API recusa): desmarca em silêncio.
    contratavel: d.contratavel && (converterPreco(d.preco) ?? 0) > 0,
    exibir_landing: d.exibir_landing,
    recursos: d.recursos.map((r) =>
      r.tipo === 'limite'
        ? {
            codigo: r.codigo as CodigoRecurso,
            habilitado: r.habilitado,
            limite: r.ilimitado ? null : Number(r.limite),
            periodo: r.periodo,
          }
        : { codigo: r.codigo as CodigoRecurso, habilitado: r.habilitado },
    ),
  };
}

// ----------------------------------------------------------------------------- página

export default function PaginaDetalhePlano() {
  const { id } = useParams();
  const ehNovo = id === 'novo';
  const catalogo = useCatalogoRecursos();
  const plano = usePlano(ehNovo ? undefined : id);

  const carregando = catalogo.isLoading || (!ehNovo && plano.isLoading);
  const erro = catalogo.error ?? (!ehNovo ? plano.error : null);

  return (
    <div>
      <Button variant="ghost" size="sm" asChild className="mb-3 -ml-2 text-muted-foreground">
        <Link to="/admin/planos">
          <ArrowLeft /> Planos
        </Link>
      </Button>
      {carregando ? (
        <Carregando />
      ) : erro || !catalogo.data || (!ehNovo && !plano.data) ? (
        <ErroCarregar
          mensagem={mensagemDeErro(erro)}
          aoTentar={() => {
            catalogo.refetch();
            if (!ehNovo) plano.refetch();
          }}
        />
      ) : (
        <FormularioPlano key={id} catalogo={catalogo.data} plano={ehNovo ? undefined : plano.data} />
      )}
    </div>
  );
}

const CAMPOS_API: Record<string, keyof Dados> = {
  'body.nome': 'nome',
  'body.descricao': 'descricao',
  'body.preco': 'preco',
};

function FormularioPlano({ catalogo, plano }: { catalogo: RecursoCatalogo[]; plano?: Plano }) {
  const navigate = useNavigate();
  const criar = useCriarPlano();
  const editar = useEditarPlano(plano?.id ?? '');
  const excluir = useExcluirPlano();
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);

  const form = useForm<Dados>({ resolver: zodResolver(esquema), defaultValues: valoresIniciais(catalogo, plano) });

  // Após salvar, o detalhe recarrega: sincroniza o formulário com o que o servidor gravou.
  useEffect(() => {
    if (plano) form.reset(valoresIniciais(catalogo, plano));
  }, [plano, catalogo, form]);

  const ativo = useWatch({ control: form.control, name: 'ativo' });
  const precoDigitado = useWatch({ control: form.control, name: 'preco' });
  const gratuito = !((converterPreco(precoDigitado) ?? 0) > 0);
  const salvando = criar.isPending || editar.isPending;

  async function salvar(dados: Dados) {
    try {
      const corpo = paraApi(dados);
      if (plano) {
        // Não reenvia plano_cadastro=false para o plano de cadastro atual (a API não permite desmarcar).
        await editar.mutateAsync({ ...corpo, plano_cadastro: dados.plano_cadastro || undefined });
        toast.success('Plano atualizado.');
      } else {
        const criado = await criar.mutateAsync(corpo);
        toast.success(`Plano "${criado.nome}" criado.`);
        navigate(`/admin/planos/${criado.id}`, { replace: true });
      }
    } catch (e) {
      if (e instanceof ErroApi) {
        for (const d of e.detalhes) {
          const campo = CAMPOS_API[d.campo];
          if (campo) form.setError(campo, { message: d.mensagem });
        }
      }
      toast.error(mensagemDeErro(e));
    }
  }

  async function confirmarExcluir() {
    if (!plano) return;
    try {
      await excluir.mutateAsync(plano.id);
      toast.success(`Plano "${plano.nome}" excluído.`);
      navigate('/admin/planos', { replace: true });
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  const podeExcluir = !!plano && !plano.plano_cadastro && plano.total_clinicas === 0;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(salvar)} noValidate>
        <CabecalhoPagina
          titulo={
            <span className="flex flex-wrap items-center gap-2">
              {plano ? plano.nome : 'Novo plano'}
              {plano?.plano_cadastro && (
                <Badge className="gap-1">
                  <Star className="fill-current" /> Plano de cadastro
                </Badge>
              )}
              {plano && <BadgeSituacao ativa={plano.ativo} rotuloAtivo="Ativo" rotuloInativo="Inativo" />}
            </span>
          }
          descricao={
            plano
              ? `${plano.total_clinicas} clínica(s) neste plano. Alterações nos limites valem imediatamente para todas elas.`
              : 'Defina o preço e quais recursos o plano libera, com os respectivos limites.'
          }
          acoes={
            <>
              {plano && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive hover:text-destructive"
                  disabled={!podeExcluir}
                  title={
                    plano.plano_cadastro
                      ? 'O plano de cadastro não pode ser excluído'
                      : plano.total_clinicas > 0
                        ? 'Há clínicas neste plano: desative-o em vez de excluir'
                        : undefined
                  }
                  onClick={() => setConfirmarExclusao(true)}
                >
                  <Trash2 /> Excluir
                </Button>
              )}
              <Button type="submit" disabled={salvando}>
                {salvando ? <Loader2 className="animate-spin" /> : <Save />}
                {plano ? 'Salvar alterações' : 'Criar plano'}
              </Button>
            </>
          }
        />

        <div className="grid gap-6 xl:grid-cols-3">
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Dados do plano</CardTitle>
              <CardDescription>Nome e preço exibidos para as clínicas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="nome"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Nome</FormLabel>
                    <FormControl>
                      <Input placeholder="Profissional" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="descricao"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrição</FormLabel>
                    <FormControl>
                      <Textarea rows={3} placeholder="Para clínicas com até 5 profissionais…" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preco"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Preço mensal (R$)</FormLabel>
                    <FormControl>
                      <Input inputMode="decimal" placeholder="149,90" {...field} />
                    </FormControl>
                    <FormDescription>Use 0,00 para planos gratuitos (ex.: teste grátis).</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="ativo"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Plano ativo</FormLabel>
                      <FormDescription>Planos inativos não podem ser atribuídos a clínicas.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={(v) => {
                          field.onChange(v);
                          if (!v) form.setValue('plano_cadastro', false);
                        }}
                        disabled={plano?.plano_cadastro}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="plano_cadastro"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Plano de cadastro</FormLabel>
                      <FormDescription>
                        {plano?.plano_cadastro
                          ? 'Este é o plano do auto-cadastro. Para trocar, marque outro plano.'
                          : 'Atribuído às clínicas que se cadastram sozinhas. Só um plano pode estar marcado.'}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={plano?.plano_cadastro || !ativo}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contratavel"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Disponível para contratação</FormLabel>
                      <FormDescription>
                        {gratuito
                          ? 'Só planos pagos podem ser contratados pela clínica.'
                          : 'Aparece em "Planos" no painel da clínica, que contrata e paga online (gateway ativo).'}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value && !gratuito} onCheckedChange={field.onChange} disabled={gratuito} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="exibir_landing"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                    <div className="space-y-0.5">
                      <FormLabel>Aparece na landing page</FormLabel>
                      <FormDescription>Mostra o plano na seção de planos do site, com preço e recursos inclusos.</FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Recursos e limites</CardTitle>
              <CardDescription>
                Habilite os recursos incluídos no plano. Limites podem valer no total ou por mês (renovam no dia 1).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="hidden grid-cols-[minmax(0,1fr)_4rem_12rem_8.5rem] gap-4 border-b pb-2 text-xs font-medium text-muted-foreground md:grid">
                <span>Recurso</span>
                <span className="text-center">Incluso</span>
                <span>Limite</span>
                <span>Período</span>
              </div>
              <ul className="divide-y">
                {catalogo.map((c, i) => (
                  <LinhaMatriz key={c.codigo} indice={i} recurso={c} control={form.control} />
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </form>

      <DialogoConfirmacao
        aberto={confirmarExclusao}
        aoMudar={setConfirmarExclusao}
        perigo
        carregando={excluir.isPending}
        aoConfirmar={confirmarExcluir}
        titulo="Excluir plano?"
        textoConfirmar="Excluir"
        descricao={`O plano "${plano?.nome}" será excluído definitivamente. Esta ação não pode ser desfeita.`}
      />
    </Form>
  );
}

function LinhaMatriz({ indice, recurso, control }: { indice: number; recurso: RecursoCatalogo; control: Control<Dados> }) {
  const linha = useWatch({ control, name: `recursos.${indice}` }) as LinhaRecurso;
  const ehLimite = recurso.tipo === 'limite';
  const desabilitado = !linha?.habilitado;

  return (
    <li className="grid gap-3 py-3.5 md:grid-cols-[minmax(0,1fr)_4rem_12rem_8.5rem] md:items-center md:gap-4">
      <div className="flex items-start justify-between gap-3 md:block">
        <div className="min-w-0">
          <p className={cn('text-sm font-medium', desabilitado && 'text-muted-foreground')}>{recurso.nome}</p>
          <p className="text-xs text-muted-foreground">
            {recurso.descricao}
            {!ehLimite && ' · liga/desliga'}
          </p>
        </div>
        {/* Switch no mobile fica ao lado do nome */}
        <div className="md:hidden">
          <CampoHabilitado indice={indice} control={control} />
        </div>
      </div>

      <div className="hidden justify-center md:flex">
        <CampoHabilitado indice={indice} control={control} />
      </div>

      {ehLimite ? (
        <>
          <div className="flex items-start gap-3">
            <FormField
              control={control}
              name={`recursos.${indice}.limite`}
              render={({ field }) => (
                <FormItem className="w-24">
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      aria-label={`Limite de ${recurso.nome}`}
                      disabled={desabilitado || linha?.ilimitado}
                      className={cn(linha?.ilimitado && 'text-muted-foreground')}
                      {...field}
                      value={linha?.ilimitado ? '' : field.value}
                      placeholder={linha?.ilimitado ? '∞' : '0'}
                    />
                  </FormControl>
                  <FormMessage className="text-xs" />
                </FormItem>
              )}
            />
            <FormField
              control={control}
              name={`recursos.${indice}.ilimitado`}
              render={({ field }) => (
                <FormItem className="flex h-9 flex-row items-center gap-1.5">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} disabled={desabilitado} />
                  </FormControl>
                  <FormLabel className="flex items-center gap-1 text-xs font-normal">
                    <IconeInfinito className="size-3.5" /> Ilimitado
                  </FormLabel>
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={control}
            name={`recursos.${indice}.periodo`}
            render={({ field }) => (
              <FormItem>
                <Select value={field.value} onValueChange={field.onChange} disabled={desabilitado || linha?.ilimitado}>
                  <FormControl>
                    <SelectTrigger className="w-full" aria-label={`Período de ${recurso.nome}`}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="total">Total</SelectItem>
                    <SelectItem value="mensal">Por mês</SelectItem>
                  </SelectContent>
                </Select>
              </FormItem>
            )}
          />
        </>
      ) : (
        <p className="text-xs text-muted-foreground md:col-span-2">
          {desabilitado ? 'Não incluso no plano' : 'Incluso no plano (sem limite de uso)'}
        </p>
      )}
    </li>
  );
}

function CampoHabilitado({ indice, control }: { indice: number; control: Control<Dados> }) {
  return (
    <FormField
      control={control}
      name={`recursos.${indice}.habilitado`}
      render={({ field }) => (
        <FormItem>
          <FormControl>
            <Switch checked={field.value} onCheckedChange={field.onChange} aria-label="Recurso incluso no plano" />
          </FormControl>
        </FormItem>
      )}
    />
  );
}
