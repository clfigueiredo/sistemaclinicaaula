/**
 * Itens de menu e papéis permitidos por rota — fonte única usada pela sidebar e pelo router.
 */
import {
  CalendarDays,
  Building2,
  Contact,
  LayoutDashboard,
  MessageCircle,
  Package,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Papel } from '@/api/tipos';

export type ItemMenu = { rotulo: string; caminho: string; icone: LucideIcon; papeis?: Papel[] };

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
  onboarding: ['admin'] as Papel[],
  /** Prontuário (abas da ficha do paciente): recepção NÃO vê. */
  prontuario: ['admin', 'profissional'] as Papel[],
};

export const MENU_CLINICA: ItemMenu[] = [
  { rotulo: 'Agenda', caminho: '/agenda', icone: CalendarDays, papeis: PAPEIS_ROTA.agenda },
  { rotulo: 'Pacientes', caminho: '/pacientes', icone: Contact, papeis: PAPEIS_ROTA.pacientes },
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
];

export function itensPermitidos(itens: ItemMenu[], papel: Papel | undefined): ItemMenu[] {
  return itens.filter((i) => !i.papeis || (papel && i.papeis.includes(papel)));
}
