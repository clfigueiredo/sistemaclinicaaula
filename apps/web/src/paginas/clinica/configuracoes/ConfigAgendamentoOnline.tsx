// Card da página Configurações (somente admin, plano com `agendamento_online`): endereço público
// (/agendar/<slug>, editado via PUT /me/clinica — 409 = endereço em uso), ativar/desativar, antecedência mínima,
// dias à frente, mensagem de boas-vindas, máximo de pendentes por telefone e profissionais visíveis
// (GET/PUT /agendamento-online/configuracao). Contrato: docs/FASE2.md §2.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, ExternalLink, Globe, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import {
  chavesAgendamentoOnline,
  useConfigAgendamentoOnline,
  useSalvarConfigAgendamentoOnline,
} from '@/api/agendamentoOnline';
import { ErroApi, mensagemDeErro } from '@/api/cliente';
import { useEditarClinica } from '@/api/me';
import { Carregando } from '@/componentes/comum';
import { Badge } from '@/componentes/ui/badge';
import { Button } from '@/componentes/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/componentes/ui/card';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Separator } from '@/componentes/ui/separator';
import { Switch } from '@/componentes/ui/switch';
import { Textarea } from '@/componentes/ui/textarea';

const REGEX_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function normalizarSlug(v: string) {
  return v
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 60);
}

type Form = {
  ativo: boolean;
  antecedencia_min_horas: string;
  dias_a_frente: string;
  max_pendentes_por_telefone: string;
  mensagem_boas_vindas: string;
  visiveis: string[];
};

export default function ConfigAgendamentoOnline() {
  const { data: cfg, isLoading, isError } = useConfigAgendamentoOnline();
  const salvar = useSalvarConfigAgendamentoOnline();
  const [form, setForm] = useState<Form | null>(null);

  useEffect(() => {
    if (!cfg) return;
    setForm({
      ativo: cfg.ativo,
      antecedencia_min_horas: String(cfg.antecedencia_min_horas),
      dias_a_frente: String(cfg.dias_a_frente),
      max_pendentes_por_telefone: String(cfg.max_pendentes_por_telefone),
      mensagem_boas_vindas: cfg.mensagem_boas_vindas ?? '',
      visiveis: cfg.profissionais.filter((p) => p.agendamento_online).map((p) => p.id),
    });
  }, [cfg]);

  if (isLoading || (!form && !isError)) {
    return (
      <Card>
        <CardContent>
          <Carregando />
        </CardContent>
      </Card>
    );
  }
  if (isError || !cfg || !form) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Não foi possível carregar a configuração do agendamento online.
        </CardContent>
      </Card>
    );
  }

  const numero = (v: string, min: number, max: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const antecedencia = numero(form.antecedencia_min_horas, 0, 168);
  const dias = numero(form.dias_a_frente, 1, 180);
  const maxPendentes = numero(form.max_pendentes_por_telefone, 1, 10);
  const valido = antecedencia !== null && dias !== null && maxPendentes !== null;

  async function gravar(parcial?: Partial<Form>) {
    const f = { ...form!, ...parcial };
    try {
      await salvar.mutateAsync({
        ativo: f.ativo,
        antecedencia_min_horas: Number(f.antecedencia_min_horas),
        dias_a_frente: Number(f.dias_a_frente),
        max_pendentes_por_telefone: Number(f.max_pendentes_por_telefone),
        mensagem_boas_vindas: f.mensagem_boas_vindas.trim() || null,
        profissionais_visiveis: f.visiveis,
      });
      toast.success(parcial?.ativo !== undefined ? (parcial.ativo ? 'Agendamento online ativado.' : 'Agendamento online desativado.') : 'Configuração salva.');
    } catch (e) {
      toast.error(mensagemDeErro(e));
    }
  }

  const profissionaisAtivos = cfg.profissionais.filter((p) => p.ativo);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Globe className="size-5 text-primary" /> Agendamento online
            </CardTitle>
            <CardDescription>
              Página pública para os pacientes pedirem horários. Cada pedido fica pendente até a recepção aprovar.
            </CardDescription>
          </div>
          <label className="flex shrink-0 items-center gap-3 rounded-lg border px-3 py-2 text-sm">
            <Switch
              checked={form.ativo}
              disabled={salvar.isPending || (!form.ativo && !cfg.slug)}
              onCheckedChange={(v) => {
                setForm({ ...form, ativo: v });
                void gravar({ ativo: v });
              }}
            />
            <span className="font-medium">{form.ativo ? 'Ativado' : 'Desativado'}</span>
          </label>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <EnderecoPublico slug={cfg.slug} link={cfg.link_publico} ativo={cfg.ativo} />

        <Separator />

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="ao-antecedencia">Antecedência mínima (horas)</Label>
            <Input
              id="ao-antecedencia"
              type="number"
              min={0}
              max={168}
              value={form.antecedencia_min_horas}
              aria-invalid={antecedencia === null || undefined}
              onChange={(e) => setForm({ ...form, antecedencia_min_horas: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">De 0 a 168 horas.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ao-dias">Dias à frente</Label>
            <Input
              id="ao-dias"
              type="number"
              min={1}
              max={180}
              value={form.dias_a_frente}
              aria-invalid={dias === null || undefined}
              onChange={(e) => setForm({ ...form, dias_a_frente: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Até quantos dias o paciente pode escolher (1 a 180).</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ao-pendentes">Pendentes por telefone</Label>
            <Input
              id="ao-pendentes"
              type="number"
              min={1}
              max={10}
              value={form.max_pendentes_por_telefone}
              aria-invalid={maxPendentes === null || undefined}
              onChange={(e) => setForm({ ...form, max_pendentes_por_telefone: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">Evita pedidos em excesso do mesmo número (1 a 10).</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ao-mensagem">Mensagem de boas-vindas</Label>
          <Textarea
            id="ao-mensagem"
            rows={3}
            maxLength={1000}
            placeholder="Ex.: Escolha o profissional e o melhor horário. Confirmaremos pelo WhatsApp em até 1 dia útil."
            value={form.mensagem_boas_vindas}
            onChange={(e) => setForm({ ...form, mensagem_boas_vindas: e.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label>Profissionais na página pública</Label>
          {profissionaisAtivos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum profissional ativo cadastrado.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {profissionaisAtivos.map((p) => {
                const marcado = form.visiveis.includes(p.id);
                return (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm hover:bg-accent">
                      <Checkbox
                        checked={marcado}
                        onCheckedChange={(v) =>
                          setForm({
                            ...form,
                            visiveis: v === true ? [...form.visiveis, p.id] : form.visiveis.filter((id) => id !== p.id),
                          })
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.nome}</span>
                        {p.especialidade && <span className="block truncate text-xs text-muted-foreground">{p.especialidade}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Só aparecem profissionais ativos com grade de horários cadastrada. Horários livres consideram a grade, os
            bloqueios, a agenda e as solicitações pendentes.
          </p>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => gravar()} disabled={!valido || salvar.isPending}>
            {salvar.isPending && <Loader2 className="size-4 animate-spin" />}
            Salvar configuração
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function EnderecoPublico({ slug, link, ativo }: { slug: string | null; link: string | null; ativo: boolean }) {
  const editar = useEditarClinica();
  const qc = useQueryClient();
  const [editando, setEditando] = useState(!slug);
  const [valor, setValor] = useState(slug ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const url = link ?? (slug ? `${window.location.origin}/agendar/${slug}` : null);

  async function salvarSlug() {
    setErro(null);
    if (!REGEX_SLUG.test(valor) || valor.length < 3) {
      setErro('Use ao menos 3 caracteres: letras minúsculas, números e hífens (sem hífen no início ou no fim).');
      return;
    }
    try {
      await editar.mutateAsync({ slug: valor });
      await qc.invalidateQueries({ queryKey: chavesAgendamentoOnline.configuracao });
      toast.success('Endereço público atualizado.', { description: 'Links antigos deixam de funcionar.' });
      setEditando(false);
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409) setErro('Este endereço já está em uso por outra clínica. Escolha outro.');
      else setErro(mensagemDeErro(e));
    }
  }

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      toast.error('Não foi possível copiar. Selecione o endereço e copie manualmente.');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Label>Endereço público</Label>
        {!ativo && slug && <Badge variant="secondary">Desativado — a página mostra “indisponível”</Badge>}
      </div>
      {editando ? (
        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="flex flex-1 items-center rounded-md border focus-within:ring-2 focus-within:ring-ring">
              <span className="truncate pl-3 text-sm text-muted-foreground">…/agendar/</span>
              <input
                className="h-9 min-w-0 flex-1 bg-transparent px-1 text-sm outline-none"
                value={valor}
                autoFocus
                placeholder="minha-clinica"
                onChange={(e) => setValor(normalizarSlug(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && salvarSlug()}
              />
            </div>
            <div className="flex gap-2">
              {slug && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setValor(slug);
                    setErro(null);
                    setEditando(false);
                  }}
                >
                  Cancelar
                </Button>
              )}
              <Button onClick={salvarSlug} disabled={editar.isPending || valor === slug}>
                {editar.isPending && <Loader2 className="size-4 animate-spin" />}
                Salvar endereço
              </Button>
            </div>
          </div>
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          {!slug && <p className="text-xs text-muted-foreground">Defina o endereço para poder ativar o agendamento online.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/50 px-3 py-2 text-sm">{url}</code>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={copiar}>
              {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </Button>
            {slug && (
              <Button variant="outline" size="sm" asChild>
                <a href={`/agendar/${slug}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Abrir
                </a>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditando(true)}>
              <Pencil className="size-4" /> Editar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
