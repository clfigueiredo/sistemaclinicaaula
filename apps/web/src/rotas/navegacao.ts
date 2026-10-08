/**
 * Itens de menu, papéis e recursos do plano por rota — fonte única usada pela sidebar e pelo router.
 *
 * Um item aparece se o papel estiver em `papeis` E (quando `recurso` existe) o recurso estiver
 * habilitado no plano (`useMe().recursos[codigo].habilitado`). Só UX: o backend também bloqueia.
 */
import {
  CalendarDays,
  Building2,
  CalendarClock,
  Contact,
  CreditCard,
  Receipt,
  Globe,
  LayoutDashboard,
  ListOrdered,
  MessageCircle,
  Package,
  Repeat,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { CodigoRecurso, Me, Papel } from '@/api/tipos';

export type ItemMenu = {
  rotulo: string;
  caminho: string;
  icone: LucideIcon;
  papeis?: Papel[];
  /** Recurso do plano que precisa estar habilitado para o item aparecer. */
  recurso?: CodigoRecurso;
};

const TODOS: Papel[] = ['admin', 'recepcao', 'profissional'];

/** Papéis por área da clínica (usado também nos guards das rotas). */
export const PAPEIS_ROTA = {
  agenda: TODOS,
  pacientes: TODOS,
  /** Profissional vê lista e detalhe em modo somente leitura (edição só admin; bloqueios admin e recepção). */
  profissionais: TODOS,
  convenios: ['admin', 'recepcao'] as Papel[],
  usuarios: ['admin'] as Papel[],
  whatsapp: ['admin'] as Papel[],
  configuracoes: ['admin'] as Papel[],
  planos: ['admin'] as Papel[],
  onboarding: ['admin'] as Papel[],
  /** Prontuário (abas da ficha do paciente): recepção NÃO vê. */
  prontuario: ['admin', 'profissional'] as Papel[],
  // ---- Fase 2 do produto (contratos em docs/FASE2.md)
  dashboard: TODOS,
  /** Solicitações do agendamento online. */
  solicitacoes: ['admin', 'recepcao'] as Papel[],
  listaEspera: ['admin', 'recepcao'] as Papel[],
  retornos: TODOS,
  /** Documentos PDF (aba da ficha): mesmos papéis do prontuário. */
  documentos: ['admin', 'profissional'] as Papel[],
  /** Área /financeiro (cada aba tem os próprios papéis abaixo). Profissional só vê Repasses. */
  financeiro: TODOS,
  financeiroCaixa: ['admin', 'recepcao'] as Papel[],
  financeiroContas: ['admin', 'recepcao'] as Papel[],
  financeiroRecorrencias: ['admin'] as Papel[],
  financeiroRepasses: ['admin', 'profissional'] as Papel[],
  financeiroRelatorios: ['admin'] as Papel[],
  financeiroConfiguracoes: ['admin'] as Papel[],
  /** Registrar recebimento de consulta no painel da agenda. */
  recebimentoConsulta: ['admin', 'recepcao'] as Papel[],
};

export const MENU_CLINICA: ItemMenu[] = [
  { rotulo: 'Dashboard', caminho: '/dashboard', icone: LayoutDashboard, papeis: PAPEIS_ROTA.dashboard, recurso: 'dashboard' },
  { rotulo: 'Agenda', caminho: '/agenda', icone: CalendarDays, papeis: PAPEIS_ROTA.agenda },
  {
    rotulo: 'Solicitações online',
    caminho: '/solicitacoes',
    icone: Globe,
    papeis: PAPEIS_ROTA.solicitacoes,
    recurso: 'agendamento_online',
  },
  { rotulo: 'Pacientes', caminho: '/pacientes', icone: Contact, papeis: PAPEIS_ROTA.pacientes },
  {
    rotulo: 'Lista de espera',
    caminho: '/lista-espera',
    icone: ListOrdered,
    papeis: PAPEIS_ROTA.listaEspera,
    recurso: 'lista_espera',
  },
  { rotulo: 'Retornos', caminho: '/retornos', icone: Repeat, papeis: PAPEIS_ROTA.retornos, recurso: 'retorno_automatico' },
  { rotulo: 'Financeiro', caminho: '/financeiro', icone: Wallet, papeis: PAPEIS_ROTA.financeiro, recurso: 'financeiro' },
  { rotulo: 'Profissionais', caminho: '/profissionais', icone: Stethoscope, papeis: PAPEIS_ROTA.profissionais },
  { rotulo: 'Convênios', caminho: '/convenios', icone: ShieldCheck, papeis: PAPEIS_ROTA.convenios },
  { rotulo: 'Usuários', caminho: '/usuarios', icone: Users, papeis: PAPEIS_ROTA.usuarios },
  { rotulo: 'WhatsApp', caminho: '/whatsapp', icone: MessageCircle, papeis: PAPEIS_ROTA.whatsapp },
  { rotulo: 'Configurações', caminho: '/configuracoes', icone: Settings, papeis: PAPEIS_ROTA.configuracoes },
];

export const MENU_ADMIN: ItemMenu[] = [
  { rotulo: 'Dashboard', caminho: '/admin', icone: LayoutDashboard },
  { rotulo: 'Planos', caminho: '/admin/planos', icone: Package },
  { rotulo: 'Clínicas', caminho: '/admin/clinicas', icone: Building2 },
  { rotulo: 'Cobranças', caminho: '/admin/cobrancas', icone: Receipt },
  { rotulo: 'Gateways', caminho: '/admin/cobranca', icone: CreditCard },
];

/** Abas da área financeira (/financeiro/*), na ordem de exibição. */
export const ABAS_FINANCEIRO: ItemMenu[] = [
  { rotulo: 'Caixa', caminho: '/financeiro/caixa', icone: Wallet, papeis: PAPEIS_ROTA.financeiroCaixa },
  { rotulo: 'Contas a pagar', caminho: '/financeiro/contas-pagar', icone: CalendarClock, papeis: PAPEIS_ROTA.financeiroContas },
  { rotulo: 'Contas a receber', caminho: '/financeiro/contas-receber', icone: CalendarClock, papeis: PAPEIS_ROTA.financeiroContas },
  { rotulo: 'Recorrências', caminho: '/financeiro/recorrencias', icone: Repeat, papeis: PAPEIS_ROTA.financeiroRecorrencias },
  { rotulo: 'Repasses', caminho: '/financeiro/repasses', icone: Users, papeis: PAPEIS_ROTA.financeiroRepasses },
  { rotulo: 'Relatórios', caminho: '/financeiro/relatorios', icone: LayoutDashboard, papeis: PAPEIS_ROTA.financeiroRelatorios },
  { rotulo: 'Configurações', caminho: '/financeiro/configuracoes', icone: Settings, papeis: PAPEIS_ROTA.financeiroConfiguracoes },
];

/** Recurso do plano habilitado? (sem `me` = ainda carregando ⇒ false). */
export function recursoHabilitado(me: Pick<Me, 'recursos'> | undefined, codigo: CodigoRecurso): boolean {
  return !!me?.recursos[codigo]?.habilitado;
}

/** Filtra por papel e, se `recursos` for informado, pelos recursos habilitados no plano. */
export function itensPermitidos(
  itens: ItemMenu[],
  papel: Papel | undefined,
  recursos?: Me['recursos'],
): ItemMenu[] {
  return itens.filter(
    (i) =>
      (!i.papeis || (papel && i.papeis.includes(papel))) &&
      (!i.recurso || !recursos || !!recursos[i.recurso]?.habilitado),
  );
}
