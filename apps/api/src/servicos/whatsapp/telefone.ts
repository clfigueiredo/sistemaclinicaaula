/**
 * Normalização de telefones para WhatsApp (formato internacional, só dígitos).
 *
 * - Números brasileiros sem DDI (10 ou 11 dígitos) ganham o prefixo 55.
 * - O WhatsApp às vezes identifica celulares brasileiros SEM o nono dígito
 *   (ex.: 551199998888 em vez de 5511999998888). Para casar respostas com pacientes,
 *   use `variantesTelefone`, que devolve as duas formas.
 */

/** Só dígitos, com DDI 55 quando o número parece brasileiro sem DDI. Retorna null se inválido. */
export function normalizarTelefone(valor: string | null | undefined): string | null {
  if (!valor) return null;
  // "5511999998888@c.us" / "5511999998888:12@s.whatsapp.net" → parte antes do @ / :
  const base = String(valor).split('@')[0].split(':')[0];
  let digitos = base.replace(/\D/g, '');
  if (!digitos) return null;
  digitos = digitos.replace(/^0+/, '');
  if (digitos.length === 10 || digitos.length === 11) digitos = `55${digitos}`;
  if (digitos.length < 10 || digitos.length > 15) return null;
  return digitos;
}

/** Variações do mesmo número (com e sem o nono dígito, para celulares do Brasil). */
export function variantesTelefone(valor: string | null | undefined): string[] {
  const t = normalizarTelefone(valor);
  if (!t) return [];
  const variantes = new Set<string>([t]);
  if (t.startsWith('55')) {
    const ddd = t.slice(2, 4);
    const numero = t.slice(4);
    if (numero.length === 9 && numero.startsWith('9')) variantes.add(`55${ddd}${numero.slice(1)}`);
    if (numero.length === 8) variantes.add(`55${ddd}9${numero}`);
  }
  return [...variantes];
}
