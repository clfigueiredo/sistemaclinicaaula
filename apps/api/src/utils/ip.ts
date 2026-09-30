/**
 * Chave de IP para rate limit e contagens anti-abuso.
 *
 * - IPv4 (e IPv4 mapeado em IPv6, `::ffff:1.2.3.4`) ⇒ o próprio endereço.
 * - IPv6 ⇒ o prefixo /64 (`2001:0db8:0000:0001::/64`): um único cliente costuma receber um /64 inteiro
 *   e pode trocar o endereço à vontade dentro dele — contar por endereço completo não limita nada.
 * - Vazio/inválido ⇒ `desconhecido` (conta junto, falha fechada).
 */
import { isIPv4, isIPv6 } from 'node:net';

function expandirIpv6(ip: string): string[] | null {
  let s = ip.split('%')[0]!.toLowerCase(); // remove zone id (fe80::1%eth0)
  // IPv4 embutido no fim (ex.: 64:ff9b::1.2.3.4) ⇒ dois hextetos
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1]!.split('.').map(Number);
    s = s.slice(0, -v4[1]!.length) + `${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`;
  }
  const partes = s.split('::');
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(':') : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(':') : [];
  const faltam = 8 - esq.length - dir.length;
  if (partes.length === 1 ? faltam !== 0 : faltam < 1) return null;
  const grupos = [...esq, ...Array(partes.length === 2 ? faltam : 0).fill('0'), ...dir];
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return grupos.map((g) => g.padStart(4, '0'));
}

export function chaveIp(ip: string | null | undefined): string {
  const bruto = (ip ?? '').trim();
  if (!bruto) return 'desconhecido';
  if (isIPv4(bruto)) return bruto;
  if (isIPv6(bruto)) {
    const mapeado = bruto.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapeado && isIPv4(mapeado[1]!)) return mapeado[1]!;
    const grupos = expandirIpv6(bruto);
    if (grupos) return `${grupos.slice(0, 4).join(':')}::/64`;
  }
  return bruto.slice(0, 64);
}
