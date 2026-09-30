// Badge de status do retorno (usado na lista /retornos e no painel da agenda). "Vencido" tem prioridade.
import type { Retorno } from '@/api/retornos';
import { ROTULOS_STATUS_RETORNO } from '@/api/tipos';
import { Badge } from '@/componentes/ui/badge';

export function BadgeStatusRetorno({ retorno }: { retorno: Pick<Retorno, 'status' | 'vencido'> }) {
  if (retorno.vencido) return <Badge variant="destructive">Vencido</Badge>;
  const variante = retorno.status === 'agendado' ? 'default' : retorno.status === 'cancelado' ? 'outline' : 'secondary';
  return <Badge variant={variante}>{ROTULOS_STATUS_RETORNO[retorno.status]}</Badge>;
}
