/**
 * Router COMPLETO da aplicação. Todas as rotas previstas (MVP + fase 2 do produto) já estão declaradas
 * e apontam para os arquivos de página em src/paginas/... Os módulos só preenchem as páginas — não é
 * preciso editar este arquivo. Guards: papéis (PAPEIS_ROTA) e recurso do plano (`recurso="..."`).
 */
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { RotaAdmin, RotaClinica, RotaPublica } from '@/componentes/layout/Guardas';
import { LayoutClinica } from '@/componentes/layout/LayoutClinica';
import { LayoutAdmin } from '@/componentes/layout/LayoutAdmin';
import { Carregando } from '@/componentes/comum';
import { PAPEIS_ROTA } from './navegacao';

const p = (fabrica: () => Promise<{ default: ComponentType }>): LazyExoticComponent<ComponentType> => lazy(fabrica);

// Públicas
const Login = p(() => import('@/paginas/publico/Login'));
const Cadastro = p(() => import('@/paginas/publico/Cadastro'));
const LoginAdmin = p(() => import('@/paginas/publico/LoginAdmin'));
const NaoEncontrada = p(() => import('@/paginas/publico/NaoEncontrada'));
const AgendamentoOnline = p(() => import('@/paginas/publico/agendar/AgendamentoOnline'));

// Super admin
const AdminDashboard = p(() => import('@/paginas/admin/Dashboard'));
const ListaPlanos = p(() => import('@/paginas/admin/planos/ListaPlanos'));
const DetalhePlano = p(() => import('@/paginas/admin/planos/DetalhePlano'));
const ListaClinicas = p(() => import('@/paginas/admin/clinicas/ListaClinicas'));
const DetalheClinica = p(() => import('@/paginas/admin/clinicas/DetalheClinica'));
const AdminCobranca = p(() => import('@/paginas/admin/cobranca/Cobranca'));
const AdminCobrancas = p(() => import('@/paginas/admin/cobranca/PaginaCobrancas'));

// Clínica
const Agenda = p(() => import('@/paginas/clinica/agenda/Agenda'));
const ListaPacientes = p(() => import('@/paginas/clinica/pacientes/ListaPacientes'));
const FichaPaciente = p(() => import('@/paginas/clinica/pacientes/FichaPaciente'));
const ListaProfissionais = p(() => import('@/paginas/clinica/profissionais/ListaProfissionais'));
const DetalheProfissional = p(() => import('@/paginas/clinica/profissionais/DetalheProfissional'));
const Convenios = p(() => import('@/paginas/clinica/convenios/Convenios'));
const Usuarios = p(() => import('@/paginas/clinica/usuarios/Usuarios'));
const WhatsApp = p(() => import('@/paginas/clinica/whatsapp/WhatsApp'));
const Onboarding = p(() => import('@/paginas/clinica/onboarding/Onboarding'));
const Configuracoes = p(() => import('@/paginas/clinica/configuracoes/Configuracoes'));
const Planos = p(() => import('@/paginas/clinica/planos/Planos'));
// Clínica — fase 2 do produto
const Dashboard = p(() => import('@/paginas/clinica/dashboard/Dashboard'));
const Solicitacoes = p(() => import('@/paginas/clinica/solicitacoes/Solicitacoes'));
const ListaEspera = p(() => import('@/paginas/clinica/lista-espera/ListaEspera'));
const Retornos = p(() => import('@/paginas/clinica/retornos/Retornos'));
const LayoutFinanceiro = p(() => import('@/paginas/clinica/financeiro/LayoutFinanceiro'));
const FinanceiroInicio = p(() => import('@/paginas/clinica/financeiro/Inicio'));
const Caixa = p(() => import('@/paginas/clinica/financeiro/Caixa'));
const ContasPagar = p(() => import('@/paginas/clinica/financeiro/ContasPagar'));
const ContasReceber = p(() => import('@/paginas/clinica/financeiro/ContasReceber'));
const Recorrencias = p(() => import('@/paginas/clinica/financeiro/Recorrencias'));
const Repasses = p(() => import('@/paginas/clinica/financeiro/Repasses'));
const RelatoriosFinanceiros = p(() => import('@/paginas/clinica/financeiro/Relatorios'));
const ConfiguracoesFinanceiras = p(() => import('@/paginas/clinica/financeiro/ConfiguracoesFinanceiras'));

function Suspenso() {
  return (
    <Suspense fallback={<Carregando telaCheia />}>
      <Outlet />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Suspenso />,
    children: [
      // ---------------- Públicas
      {
        element: <RotaPublica tipo="clinica" />,
        children: [
          { path: '/login', element: <Login /> },
          { path: '/cadastro', element: <Cadastro /> },
        ],
      },
      { element: <RotaPublica tipo="admin" />, children: [{ path: '/admin/login', element: <LoginAdmin /> }] },
      // Agendamento online (público, sem login; acessível mesmo logado)
      { path: '/agendar/:slug', element: <AgendamentoOnline /> },

      // ---------------- Super admin
      {
        path: '/admin',
        element: <RotaAdmin />,
        children: [
          {
            element: <LayoutAdmin />,
            children: [
              { index: true, element: <AdminDashboard /> },
              { path: 'planos', element: <ListaPlanos /> },
              { path: 'planos/:id', element: <DetalhePlano /> },
              { path: 'clinicas', element: <ListaClinicas /> },
              { path: 'clinicas/:id', element: <DetalheClinica /> },
              { path: 'cobranca', element: <AdminCobranca /> },
              { path: 'cobrancas', element: <AdminCobrancas /> },
            ],
          },
        ],
      },

      // ---------------- Clínica
      {
        path: '/',
        element: <RotaClinica />,
        children: [
          {
            element: <LayoutClinica />,
            children: [
              { index: true, element: <Navigate to="/agenda" replace /> },
              { path: 'agenda', element: <RotaClinica papeis={PAPEIS_ROTA.agenda}><Agenda /></RotaClinica> },
              { path: 'pacientes', element: <RotaClinica papeis={PAPEIS_ROTA.pacientes}><ListaPacientes /></RotaClinica> },
              { path: 'pacientes/:id', element: <RotaClinica papeis={PAPEIS_ROTA.pacientes}><FichaPaciente /></RotaClinica> },
              {
                path: 'profissionais',
                element: <RotaClinica papeis={PAPEIS_ROTA.profissionais}><ListaProfissionais /></RotaClinica>,
              },
              {
                path: 'profissionais/:id',
                element: <RotaClinica papeis={PAPEIS_ROTA.profissionais}><DetalheProfissional /></RotaClinica>,
              },
              { path: 'convenios', element: <RotaClinica papeis={PAPEIS_ROTA.convenios}><Convenios /></RotaClinica> },
              { path: 'usuarios', element: <RotaClinica papeis={PAPEIS_ROTA.usuarios}><Usuarios /></RotaClinica> },
              { path: 'whatsapp', element: <RotaClinica papeis={PAPEIS_ROTA.whatsapp}><WhatsApp /></RotaClinica> },
              { path: 'onboarding', element: <RotaClinica papeis={PAPEIS_ROTA.onboarding}><Onboarding /></RotaClinica> },
              {
                path: 'configuracoes',
                element: <RotaClinica papeis={PAPEIS_ROTA.configuracoes}><Configuracoes /></RotaClinica>,
              },
              { path: 'planos', element: <RotaClinica papeis={PAPEIS_ROTA.planos}><Planos /></RotaClinica> },
              // ---------------- Fase 2 do produto (docs/FASE2.md)
              {
                path: 'dashboard',
                element: <RotaClinica papeis={PAPEIS_ROTA.dashboard} recurso="dashboard"><Dashboard /></RotaClinica>,
              },
              {
                path: 'solicitacoes',
                element: (
                  <RotaClinica papeis={PAPEIS_ROTA.solicitacoes} recurso="agendamento_online">
                    <Solicitacoes />
                  </RotaClinica>
                ),
              },
              {
                path: 'lista-espera',
                element: (
                  <RotaClinica papeis={PAPEIS_ROTA.listaEspera} recurso="lista_espera">
                    <ListaEspera />
                  </RotaClinica>
                ),
              },
              {
                path: 'retornos',
                element: (
                  <RotaClinica papeis={PAPEIS_ROTA.retornos} recurso="retorno_automatico">
                    <Retornos />
                  </RotaClinica>
                ),
              },
              {
                path: 'financeiro',
                element: (
                  <RotaClinica papeis={PAPEIS_ROTA.financeiro} recurso="financeiro">
                    <LayoutFinanceiro />
                  </RotaClinica>
                ),
                children: [
                  { index: true, element: <FinanceiroInicio /> },
                  {
                    path: 'caixa',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroCaixa}><Caixa /></RotaClinica>,
                  },
                  {
                    path: 'contas-pagar',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroContas}><ContasPagar /></RotaClinica>,
                  },
                  {
                    path: 'contas-receber',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroContas}><ContasReceber /></RotaClinica>,
                  },
                  {
                    path: 'recorrencias',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroRecorrencias}><Recorrencias /></RotaClinica>,
                  },
                  {
                    path: 'repasses',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroRepasses}><Repasses /></RotaClinica>,
                  },
                  {
                    path: 'relatorios',
                    element: <RotaClinica papeis={PAPEIS_ROTA.financeiroRelatorios}><RelatoriosFinanceiros /></RotaClinica>,
                  },
                  {
                    path: 'configuracoes',
                    element: (
                      <RotaClinica papeis={PAPEIS_ROTA.financeiroConfiguracoes}>
                        <ConfiguracoesFinanceiras />
                      </RotaClinica>
                    ),
                  },
                ],
              },
            ],
          },
        ],
      },

      { path: '*', element: <NaoEncontrada /> },
    ],
  },
]);
