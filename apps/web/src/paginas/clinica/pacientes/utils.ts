/** Utilitários das telas de pacientes/prontuário. */
import { useEffect, useState } from 'react';
import { differenceInYears, parseISO } from 'date-fns';
import { mascararCpf, mascararTelefone, somenteDigitos } from '@/lib/formatos';

/** Telefone salvo com DDI 55 (ex.: 5511999998888) → "(11) 99999-8888". */
export function exibirTelefone(v: string | null | undefined): string {
  if (!v) return '—';
  const d = somenteDigitos(v);
  const nacional = (d.length === 12 || d.length === 13) && d.startsWith('55') ? d.slice(2) : d;
  return mascararTelefone(nacional);
}

/** Valor do banco (com 55) → valor para o campo com máscara. */
export function telefoneParaCampo(v: string | null | undefined): string {
  return v ? exibirTelefone(v) : '';
}

export function exibirCpf(v: string | null | undefined): string {
  return v ? mascararCpf(v) : '—';
}

/** "AAAA-MM-DD" → idade em anos. */
export function calcularIdade(nascimento: string | null | undefined): number | null {
  if (!nascimento) return null;
  const idade = differenceInYears(new Date(), parseISO(nascimento));
  return Number.isFinite(idade) ? idade : null;
}

/** "AAAA-MM-DD" → "dd/mm/aaaa" (sem conversão de fuso). */
export function exibirDataSimples(v: string | null | undefined): string {
  if (!v) return '—';
  const [a, m, d] = v.slice(0, 10).split('-');
  return a && m && d ? `${d}/${m}/${a}` : '—';
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function useDebounce<T>(valor: T, atrasoMs = 350): T {
  const [atual, setAtual] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtual(valor), atrasoMs);
    return () => clearTimeout(t);
  }, [valor, atrasoMs]);
  return atual;
}
