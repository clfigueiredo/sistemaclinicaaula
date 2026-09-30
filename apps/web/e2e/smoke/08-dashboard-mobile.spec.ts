/**
 * Fase 2 — fluxo 12: dashboard por papel (admin, recepção, profissional) e telas novas em ~390 px.
 */
import { expect, test } from '@playwright/test';
import { foto, loginClinica, monitorar, semRolagemHorizontal } from './utils';

test('dashboard: blocos corretos por papel', async ({ browser }, info) => {
  // Admin: agenda + financeiro + pendências (com solicitações e lista de espera).
  const admin = await browser.newPage();
  monitorar(admin, info);
  await loginClinica(admin, 'admin@demo.local');
  await admin.goto('/dashboard');
  const main = admin.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await expect(main).toContainText('Agenda de hoje');
  await expect(main).toContainText('Abrir financeiro');
  await expect(main).toContainText('Solicitações online pendentes');
  await expect(main).toContainText('Pessoas na lista de espera');
  await foto(admin, '12-dashboard-admin');

  // Celular (390 px): telas novas sem rolagem horizontal.
  await admin.setViewportSize({ width: 390, height: 844 });
  for (const rota of ['/dashboard', '/financeiro/caixa', '/financeiro/contas-pagar', '/financeiro/relatorios', '/solicitacoes', '/lista-espera', '/retornos', '/configuracoes']) {
    await admin.goto(rota);
    await admin.waitForLoadState('networkidle');
    await semRolagemHorizontal(admin, rota);
    await foto(admin, `12-mobile${rota.replaceAll('/', '-')}`);
  }
  await admin.close();

  // Recepção: sem financeiro; com pendências de solicitações/lista de espera.
  const rec = await browser.newPage();
  monitorar(rec, info);
  await loginClinica(rec, 'recepcao@demo.local');
  await rec.goto('/dashboard');
  const mainRec = rec.getByRole('main');
  await expect(mainRec).toContainText('Agenda de hoje');
  await expect(mainRec).toContainText('Solicitações online pendentes');
  await expect(mainRec).not.toContainText('Abrir financeiro');
  await foto(rec, '12-dashboard-recepcao');
  await rec.close();

  // Profissional: só a própria agenda; sem financeiro, solicitações nem lista de espera.
  const prof = await browser.newPage();
  monitorar(prof, info);
  await loginClinica(prof, 'profissional@demo.local');
  await prof.goto('/dashboard');
  const mainProf = prof.getByRole('main');
  await expect(mainProf).toContainText('Agenda de hoje');
  await expect(mainProf).not.toContainText('Abrir financeiro');
  await expect(mainProf).not.toContainText('Solicitações online pendentes');
  await expect(mainProf).not.toContainText('Pessoas na lista de espera');
  await foto(prof, '12-dashboard-profissional');
  await prof.close();
});
