/**
 * Fase 2 — fluxos 6 e 7.
 *  - Super admin: /admin/cobranca (abas, salvar configuração de gateway em sandbox com chave FICTÍCIA — não
 *    ativa nem testa conexão, para não chamar API externa), planos com os 6 recursos novos e bloco de cobrança
 *    no detalhe da clínica.
 *  - Agendamento online: página pública /agendar/clinica-demo (390 px e desktop) → recepção aprova uma
 *    solicitação (aparece na agenda) e recusa outra.
 */
import { expect, test, type Page } from '@playwright/test';
import { foto, loginAdmin, loginClinica, monitorar, semRolagemHorizontal, toast } from './utils';

const ID_CLINICA_DEMO = '00000000-0000-4000-8000-000000000101';
const RECURSOS_FASE2 = ['Financeiro', 'Agendamento online', 'Lista de espera', 'Receituário e atestados', 'Retorno automático', 'Dashboard'];

test('super admin: cobrança, planos e bloco de cobrança da clínica', async ({ page }, info) => {
  monitorar(page, info);
  await loginAdmin(page);

  await page.goto('/admin/cobranca');
  await expect(page.getByRole('heading', { name: 'Cobrança', level: 1 })).toBeVisible();
  // Configuração do Mercado Pago em sandbox com credencial fictícia (fica "configurado", mas NÃO é ativado).
  await page.getByRole('tab', { name: /Mercado Pago/ }).click();
  await page.getByLabel('Access token').fill(`TEST-e2e-${Date.now()}-token-ficticio`);
  await page.getByLabel('Dias de tolerância').fill('7');
  await page.getByRole('button', { name: 'Salvar configuração' }).click();
  await toast(page, 'Configuração do Mercado Pago salva.');
  await expect(page.getByRole('tab', { name: /Mercado Pago/ })).not.toContainText('Não configurado');
  await expect(page.getByText('Nenhum gateway ativo')).toBeVisible();
  await foto(page, '06-admin-cobranca-gateways');

  await page.getByRole('tab', { name: 'Cobranças' }).click();
  await expect(page.getByRole('button', { name: /Gerar cobrança/ }).first()).toBeVisible();
  await foto(page, '06-admin-cobranca-cobrancas');
  await page.getByRole('tab', { name: 'Eventos' }).click();
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await foto(page, '06-admin-cobranca-eventos');

  // Planos: os 6 recursos novos, sem "(fase 2)".
  await page.goto('/admin/planos');
  await page.getByRole('button', { name: 'Ações do plano Profissional' }).click();
  await page.getByRole('menuitem', { name: /Editar/ }).first().click();
  await expect(page.getByRole('main')).toContainText('Dashboard');
  for (const nome of RECURSOS_FASE2) await expect(page.getByRole('main')).toContainText(nome);
  await expect(page.getByRole('main')).not.toContainText('fase 2');
  await foto(page, '06-admin-plano-recursos');

  // Detalhe da clínica: bloco de cobrança.
  await page.goto(`/admin/clinicas/${ID_CLINICA_DEMO}`);
  const bloco = page.locator('[data-slot=card]', { hasText: 'Cobrança automática' }).first();
  await expect(bloco).toContainText(/Cobrança automática (ligada|desligada)/);
  await bloco.getByRole('button', { name: 'Cobrança automática' }).click();
  await expect(page.getByRole('dialog')).toContainText('Ative um gateway na aba Gateways');
  await foto(page, '06-admin-clinica-cobranca-dialogo', false);
  await page.getByRole('dialog').getByRole('button', { name: 'Fechar' }).first().click();
  await foto(page, '06-admin-clinica-cobranca');
});

/** Escolhe o 1º dia com horário livre e o 1º horário dele. Retorna o texto do horário. */
async function escolherHorario(page: Page) {
  const horarios = page.getByRole('button', { name: /^\d{2}:\d{2}$/ });
  for (let pagina = 0; pagina < 3; pagina++) {
    const dias = page.locator('button[aria-pressed]');
    const n = await dias.count();
    for (let i = 0; i < n; i++) {
      await dias.nth(i).click();
      await page.waitForTimeout(300);
      await expect(page.getByText(/Buscando horários/)).toBeHidden();
      if ((await horarios.count()) > 0) {
        // Um horário aleatório reduz colisão entre execuções.
        const k = Math.floor(Math.random() * (await horarios.count()));
        const texto = (await horarios.nth(k).textContent())!.trim();
        await horarios.nth(k).click();
        return texto;
      }
    }
    await page.getByRole('button', { name: 'Próximos dias' }).click();
  }
  throw new Error('Nenhum horário livre encontrado na página pública.');
}

async function solicitar(page: Page, nome: string, telefone: string) {
  await page.goto('/agendar/clinica-demo');
  await page.getByRole('button', { name: /Dra\. Ana Souza/ }).click();
  await expect(page.getByRole('heading', { name: 'Escolha o dia e o horário' })).toBeVisible();
  await escolherHorario(page);
  await expect(page.getByRole('heading', { name: 'Seus dados' })).toBeVisible();
  await page.getByLabel('Nome completo').fill(nome);
  await page.getByRole('textbox', { name: 'WhatsApp' }).fill(telefone);
  // Sem consentimento: a Clínica Demo pode estar com WhatsApp real conectado — nada deve ser enviado a números fictícios.
  const consentimento = page.getByRole('checkbox', { name: /Aceito receber mensagens/ });
  if ((await consentimento.getAttribute('aria-checked')) === 'true') await consentimento.click();
  await page.getByRole('button', { name: 'Solicitar agendamento' }).click();
  await expect(page.getByRole('heading', { name: 'Solicitação enviada!' })).toBeVisible();
}

test('agendamento online: página pública (390 px e desktop) e aprovação/recusa pela recepção', async ({ browser }, info) => {
  const sufixo = Date.now().toString().slice(-6);
  const aprovar = `Online Aprovar ${sufixo}`;
  const recusar = `Online Recusar ${sufixo}`;

  // Celular (390 px)
  const celular = await browser.newPage({ viewport: { width: 390, height: 844 } });
  monitorar(celular, info);
  await celular.goto('/agendar/clinica-demo');
  await expect(celular.getByRole('heading', { name: 'Clínica Demo' })).toBeVisible();
  await semRolagemHorizontal(celular, '/agendar (390 px)');
  await foto(celular, '07-publico-mobile-inicio');
  await solicitar(celular, aprovar, `11 9${sufixo.slice(0, 4)}-${sufixo.slice(2, 6)}`);
  await semRolagemHorizontal(celular, '/agendar enviado (390 px)');
  await foto(celular, '07-publico-mobile-enviado');
  await celular.close();

  // Desktop
  const desktop = await browser.newPage();
  monitorar(desktop, info);
  await solicitar(desktop, recusar, `21 9${sufixo.slice(2, 6)}-${sufixo.slice(0, 4)}`);
  await foto(desktop, '07-publico-desktop-enviado');

  // Recepção: aprova uma e recusa a outra.
  await loginClinica(desktop, 'recepcao@demo.local');
  await desktop.goto('/solicitacoes');
  const cartaoAprovar = desktop.locator('[data-slot=card]', { hasText: aprovar });
  await expect(cartaoAprovar).toBeVisible();
  await foto(desktop, '07-solicitacoes');
  await cartaoAprovar.getByRole('button', { name: 'Aprovar' }).click();
  await expect(desktop.getByRole('dialog')).toContainText('Aprovar solicitação');
  await desktop.getByRole('dialog').getByRole('button', { name: 'Aprovar e agendar' }).click();
  await toast(desktop, /Agendamento criado/);

  const cartaoRecusar = desktop.locator('[data-slot=card]', { hasText: recusar });
  await cartaoRecusar.getByRole('button', { name: 'Recusar' }).click();
  await desktop.getByLabel('Motivo').fill('Horário reservado para retorno (teste E2E).');
  await desktop.getByRole('dialog').getByRole('button', { name: 'Recusar' }).click();
  await toast(desktop, 'Solicitação recusada.');

  // A aprovada aparece na agenda.
  await desktop.getByRole('tab', { name: /Aprovadas/ }).click();
  await desktop.locator('[data-slot=card]', { hasText: aprovar }).getByRole('link', { name: 'Ver na agenda' }).click();
  await expect(desktop).toHaveURL(/\/agenda/);
  await expect(desktop.getByRole('dialog')).toContainText(aprovar);
  await foto(desktop, '07-agenda-aprovada', false);
  await desktop.close();
});
