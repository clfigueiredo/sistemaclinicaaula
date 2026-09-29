// Combobox de paciente com busca (GET /pacientes?busca=) e cadastro rápido (POST /pacientes).
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api, mensagemDeErro } from '@/api/cliente';
import { Button } from '@/componentes/ui/button';
import { Checkbox } from '@/componentes/ui/checkbox';
import { Input } from '@/componentes/ui/input';
import { Label } from '@/componentes/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/componentes/ui/popover';
import { mascararTelefone, somenteDigitos } from '@/lib/formatos';
import { cn } from '@/lib/utils';
import type { PacienteResumo } from './utilidades';

export type PacienteSelecionado = { id: string; nome: string; convenio_id?: string | null };

function useDebounce<T>(valor: T, ms = 300): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export function BuscaPaciente({
  valor,
  onChange,
  invalido,
  desabilitado,
}: {
  valor: PacienteSelecionado | null;
  onChange: (p: PacienteSelecionado | null) => void;
  invalido?: boolean;
  desabilitado?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [termo, setTermo] = useState('');
  const [cadastrando, setCadastrando] = useState(false);
  const busca = useDebounce(termo.trim());

  const { data, isFetching, isError } = useQuery({
    queryKey: ['agendamentos', 'busca-pacientes', busca],
    queryFn: () =>
      api.get<{ itens: PacienteResumo[]; total: number }>('/pacientes', { busca, pagina: 1, porPagina: 10 }),
    enabled: aberto,
    staleTime: 15_000,
  });
  const itens = data?.itens ?? [];

  return (
    <Popover
      open={aberto}
      onOpenChange={(a) => {
        setAberto(a);
        if (!a) setCadastrando(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={aberto}
          aria-invalid={invalido || undefined}
          disabled={desabilitado}
          className={cn('w-full justify-between font-normal', !valor && 'text-muted-foreground')}
        >
          <span className="truncate">{valor ? valor.nome : 'Buscar paciente…'}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        {cadastrando ? (
          <CadastroRapido
            nomeInicial={termo}
            onCancelar={() => setCadastrando(false)}
            onCriado={(p) => {
              onChange(p);
              setCadastrando(false);
              setAberto(false);
            }}
          />
        ) : (
          <div className="flex flex-col">
            <div className="border-b p-2">
              <Input
                autoFocus
                placeholder="Nome, CPF ou telefone…"
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
              />
            </div>
            <ul className="max-h-64 overflow-y-auto p-1" role="listbox">
              {isFetching && itens.length === 0 && (
                <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Buscando…
                </li>
              )}
              {isError && <li className="px-2 py-3 text-sm text-destructive">Não foi possível buscar pacientes.</li>}
              {!isFetching && !isError && itens.length === 0 && (
                <li className="px-2 py-3 text-sm text-muted-foreground">Nenhum paciente encontrado.</li>
              )}
              {itens.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={valor?.id === p.id}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      onChange({ id: p.id, nome: p.nome, convenio_id: p.convenio_id });
                      setAberto(false);
                    }}
                  >
                    <Check className={cn('size-4', valor?.id === p.id ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.nome}</span>
                      {(p.telefone || p.whatsapp) && (
                        <span className="block text-xs text-muted-foreground">
                          {mascararTelefone(p.telefone || (p.whatsapp ?? '').replace(/^55/, ''))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t p-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                onClick={() => setCadastrando(true)}
              >
                <UserPlus className="size-4" /> Cadastrar paciente rápido
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CadastroRapido({
  nomeInicial,
  onCancelar,
  onCriado,
}: {
  nomeInicial: string;
  onCancelar: () => void;
  onCriado: (p: PacienteSelecionado) => void;
}) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(/\d/.test(nomeInicial) ? '' : nomeInicial);
  const [telefone, setTelefone] = useState('');
  const [aceita, setAceita] = useState(true);

  const criar = useMutation({
    mutationFn: () => {
      const tel = somenteDigitos(telefone);
      return api.post<PacienteResumo>('/pacientes', {
        nome: nome.trim(),
        telefone: tel || null,
        whatsapp: tel ? `55${tel}` : null,
        aceita_whatsapp: !!tel && aceita,
      });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['pacientes'] });
      qc.invalidateQueries({ queryKey: ['agendamentos', 'busca-pacientes'] });
      toast.success('Paciente cadastrado.');
      onCriado({ id: p.id, nome: p.nome, convenio_id: p.convenio_id });
    },
    onError: (e) => toast.error(mensagemDeErro(e)),
  });

  const valido = nome.trim().length >= 3;

  return (
    <form
      className="space-y-3 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (valido) criar.mutate();
      }}
    >
      <p className="text-sm font-medium">Cadastro rápido de paciente</p>
      <div className="space-y-1.5">
        <Label htmlFor="cr-nome">Nome completo</Label>
        <Input id="cr-nome" autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="cr-tel">Celular / WhatsApp</Label>
        <Input
          id="cr-tel"
          inputMode="tel"
          placeholder="(11) 99999-9999"
          value={telefone}
          onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={aceita} onCheckedChange={(v) => setAceita(v === true)} />
        Aceita receber lembretes por WhatsApp
      </label>
      <p className="text-xs text-muted-foreground">Complete o cadastro depois na ficha do paciente.</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>
          Voltar
        </Button>
        <Button type="submit" size="sm" disabled={!valido || criar.isPending}>
          {criar.isPending && <Loader2 className="size-4 animate-spin" />}
          Cadastrar
        </Button>
      </div>
    </form>
  );
}
