/** Máscaras, validações e formatação (pt-BR). */
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function somenteDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export function mascararCpf(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function mascararCnpj(v: string): string {
  const d = somenteDigitos(v).slice(0, 14);
  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** CPF até 11 dígitos, CNPJ a partir do 12º. */
export function mascararCpfCnpj(v: string): string {
  return somenteDigitos(v).length <= 11 ? mascararCpf(v) : mascararCnpj(v);
}

export function mascararTelefone(v: string): string {
  const d = somenteDigitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

export function validarCpf(v: string): boolean {
  const cpf = somenteDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n - 1; i++) soma += Number(cpf[i]) * (n - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(10) === Number(cpf[9]) && dv(11) === Number(cpf[10]);
}

export function validarCnpj(v: string): boolean {
  const c = somenteDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + Number(c[i]) * p, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

export function validarCpfOuCnpj(v: string): boolean {
  const d = somenteDigitos(v);
  return d.length === 11 ? validarCpf(d) : d.length === 14 ? validarCnpj(d) : false;
}

function comoData(d: string | Date): Date {
  return typeof d === 'string' ? parseISO(d) : d;
}

/** 29/09/2026 */
export function formatarData(d: string | Date | null | undefined): string {
  return d ? format(comoData(d), 'dd/MM/yyyy', { locale: ptBR }) : '—';
}

/** 29/09/2026 14:30 */
export function formatarDataHora(d: string | Date | null | undefined): string {
  return d ? format(comoData(d), "dd/MM/yyyy HH:mm", { locale: ptBR }) : '—';
}

export function formatarMoeda(v: number | string | null | undefined): string {
  const n = typeof v === 'string' ? Number(v) : (v ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
