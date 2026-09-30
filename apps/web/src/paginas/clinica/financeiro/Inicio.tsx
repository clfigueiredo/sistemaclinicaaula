// Índice de /financeiro: redireciona para a primeira aba permitida ao papel (profissional → Repasses).
// DONO: módulo `financeiro` (pode trocar por uma visão geral).
import { Navigate } from 'react-router-dom';
import { useMe } from '@/api/me';
import { ABAS_FINANCEIRO, itensPermitidos } from '@/rotas/navegacao';
import { Carregando, SemPermissao } from '@/componentes/comum';

export default function FinanceiroInicio() {
  const { data: me } = useMe();
  if (!me) return <Carregando />;
  const primeira = itensPermitidos(ABAS_FINANCEIRO, me.papel)[0];
  return primeira ? <Navigate to={primeira.caminho} replace /> : <SemPermissao />;
}
