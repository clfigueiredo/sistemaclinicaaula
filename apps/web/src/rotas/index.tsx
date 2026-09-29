/**
 * Router COMPLETO da aplicação. Todas as rotas previstas já estão declaradas e apontam para os
 * arquivos de página em src/paginas/... Os módulos da fase 2 só preenchem as páginas — não é
 * preciso editar este arquivo.
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

// Super admin
const AdminDashboard = p(() => import('@/paginas/admin/Dashboard'));
const ListaPlanos = p(() => import('@/paginas/admin/planos/ListaPlanos'));
const DetalhePlano = p(() => import('@/paginas/admin/planos/DetalhePlano'));
const ListaClinicas = p(() => import('@/paginas/admin/clinicas/ListaClinicas'));
const DetalheClinica = p(() => import('@/paginas/admin/clinicas/DetalheClinica'));

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
            ],
          },
        ],
      },

      { path: '*', element: <NaoEncontrada /> },
    ],
  },
]);
