/**
 * Catálogo dos e-mails transacionais: textos PADRÃO (usados enquanto o super admin não editar o modelo em
 * /admin/email), variáveis disponíveis em cada um e qual variável é o link do botão.
 *
 * Marcação do corpo (renderizar.ts): parágrafos separados por linha em branco, **negrito**, linhas "- " viram
 * lista e `{variavel}` é substituída (com escape de HTML). O layout (cabeçalho, botão, rodapé) é fixo.
 */
import type { TipoEmail } from '@prisma/client';

export type VariavelEmail = { nome: string; descricao: string; exemplo: string };

export type DefinicaoEmail = {
  nome: string;
  descricao: string;
  /** Variável cujo valor é a URL do botão. */
  variavelLink: string;
  /** false = não pode ser desligado no painel (ex.: redefinição de senha). */
  desligavel: boolean;
  variaveis: VariavelEmail[];
  padrao: { assunto: string; corpo: string; texto_botao: string };
};

const V = {
  responsavel: { nome: 'responsavel', descricao: 'Nome do responsável pela clínica', exemplo: 'Maria Silva' },
  clinica: { nome: 'clinica', descricao: 'Nome da clínica', exemplo: 'Clínica Bem Estar' },
  plano: { nome: 'plano', descricao: 'Nome do plano', exemplo: 'Profissional' },
  valor: { nome: 'valor', descricao: 'Valor da cobrança (R$)', exemplo: 'R$ 199,90' },
  linkAcesso: { nome: 'link_acesso', descricao: 'Endereço de login do sistema', exemplo: 'https://sistema.exemplo.com/login' },
  dataPagamento: { nome: 'data_pagamento', descricao: 'Data do pagamento', exemplo: '08/10/2026' },
  proximoVencimento: { nome: 'proximo_vencimento', descricao: 'Data do próximo vencimento', exemplo: '08/11/2026' },
  expiraEm: { nome: 'expira_em', descricao: 'Acesso garantido até', exemplo: '13/11/2026' },
} satisfies Record<string, VariavelEmail>;

export const CATALOGO_EMAILS: Record<TipoEmail, DefinicaoEmail> = {
  boas_vindas: {
    nome: 'Boas-vindas (cadastro do teste grátis)',
    descricao: 'Enviado logo depois do auto-cadastro, para o e-mail do responsável. A senha nunca vai no e-mail.',
    variavelLink: 'link_acesso',
    desligavel: true,
    variaveis: [
      V.responsavel,
      V.clinica,
      { nome: 'email', descricao: 'Login (e-mail cadastrado)', exemplo: 'maria@clinicabemestar.com.br' },
      V.linkAcesso,
      { nome: 'link_esqueci_senha', descricao: 'Página "Esqueci minha senha"', exemplo: 'https://sistema.exemplo.com/esqueci-senha' },
    ],
    padrao: {
      assunto: 'Bem-vindo(a) ao Sistema Clínica — sua conta está pronta',
      corpo: [
        'Olá, {responsavel}!',
        'A **{clinica}** já está cadastrada no Sistema Clínica e o seu teste grátis começou. Você pode experimentar todas as funções: agenda, prontuário, WhatsApp, financeiro e muito mais.',
        '**Seus dados de acesso**\n- Endereço: {link_acesso}\n- Login: {email}\n- Senha: a que você criou no cadastro',
        '**Primeiros passos:** cadastre um profissional e o horário de atendimento, conecte o WhatsApp da clínica e marque o primeiro agendamento.',
        'Esqueceu a senha? Acesse {link_esqueci_senha}.',
        'Qualquer dúvida, é só responder este e-mail.',
      ].join('\n\n'),
      texto_botao: 'Acessar o sistema',
    },
  },
  redefinir_senha: {
    nome: 'Redefinição de senha',
    descricao: 'Enviado pelo "Esqueci minha senha". Um e-mail por clínica em que o e-mail tem acesso. Não pode ser desligado.',
    variavelLink: 'link_redefinir',
    desligavel: false,
    variaveis: [
      { nome: 'nome', descricao: 'Nome do usuário', exemplo: 'Maria Silva' },
      V.clinica,
      { nome: 'link_redefinir', descricao: 'Link para criar a nova senha', exemplo: 'https://sistema.exemplo.com/redefinir-senha?token=…' },
      { nome: 'validade', descricao: 'Por quanto tempo o link vale', exemplo: '1 hora' },
    ],
    padrao: {
      assunto: 'Redefinição de senha — Sistema Clínica',
      corpo: [
        'Olá, {nome}!',
        'Recebemos um pedido para criar uma nova senha para o seu acesso na **{clinica}**.',
        'Clique no botão abaixo para escolher a nova senha. O link vale por **{validade}** e só pode ser usado uma vez.',
        'Se você não pediu a troca, ignore este e-mail: sua senha atual continua valendo.',
      ].join('\n\n'),
      texto_botao: 'Criar nova senha',
    },
  },
  pagamento_confirmado: {
    nome: 'Pagamento confirmado (primeiro plano pago ou upgrade)',
    descricao: 'Enviado quando o pagamento da contratação de um plano (página Planos da clínica) é confirmado.',
    variavelLink: 'link_acesso',
    desligavel: true,
    variaveis: [
      V.responsavel,
      V.clinica,
      V.plano,
      V.valor,
      V.dataPagamento,
      V.proximoVencimento,
      V.expiraEm,
      V.linkAcesso,
    ],
    padrao: {
      assunto: 'Pagamento confirmado — plano {plano} liberado',
      corpo: [
        'Olá, {responsavel}!',
        'Recebemos o pagamento de **{valor}** referente ao plano **{plano}** da **{clinica}**. Obrigado pela confiança!',
        'O plano já está ativo e todos os recursos dele foram liberados.',
        '- Pagamento em: {data_pagamento}\n- Acesso garantido até: {expira_em}\n- Próxima mensalidade: {proximo_vencimento}',
        'Suas faturas ficam em **Configurações → Minhas faturas**. Qualquer dúvida, é só responder este e-mail.',
      ].join('\n\n'),
      texto_botao: 'Acessar o sistema',
    },
  },
  aviso_renovacao: {
    nome: 'Aviso de renovação (2 dias antes do vencimento)',
    descricao: 'Enviado pelo job diário de cobranças para mensalidades em aberto que vencem daqui a 2 dias.',
    variavelLink: 'link_fatura',
    desligavel: true,
    variaveis: [
      V.responsavel,
      V.clinica,
      V.plano,
      V.valor,
      { nome: 'vencimento', descricao: 'Data de vencimento', exemplo: '10/10/2026' },
      { nome: 'data_bloqueio', descricao: 'Último dia antes da suspensão (vencimento + tolerância)', exemplo: '15/10/2026' },
      { nome: 'link_fatura', descricao: 'Link da fatura no gateway', exemplo: 'https://www.asaas.com/i/abc123' },
    ],
    padrao: {
      assunto: 'Sua mensalidade vence em 2 dias — {clinica}',
      corpo: [
        'Olá, {responsavel}!',
        'A mensalidade do plano **{plano}** da **{clinica}**, no valor de **{valor}**, vence em **{vencimento}**.',
        'Para pagar, use o botão abaixo (Pix, boleto ou cartão, conforme as opções da fatura).',
        'Se já pagou, desconsidere este aviso. Para manter o acesso sem interrupção, o pagamento precisa ser confirmado até **{data_bloqueio}**.',
      ].join('\n\n'),
      texto_botao: 'Ver fatura e pagar',
    },
  },
  pagamento_renovado: {
    nome: 'Pagamento da mensalidade recebido (com nº da parcela)',
    descricao: 'Enviado quando uma mensalidade (cobrança mensal automática) é paga.',
    variavelLink: 'link_acesso',
    desligavel: true,
    variaveis: [
      V.responsavel,
      V.clinica,
      V.plano,
      V.valor,
      { nome: 'parcela', descricao: 'Número da parcela (a contratação conta como a 1ª)', exemplo: '3' },
      V.dataPagamento,
      V.expiraEm,
      V.proximoVencimento,
      V.linkAcesso,
    ],
    padrao: {
      assunto: 'Pagamento recebido — parcela {parcela} do plano {plano}',
      corpo: [
        'Olá, {responsavel}!',
        'Confirmamos o pagamento da **parcela {parcela}** do plano **{plano}** da **{clinica}**: **{valor}**, pago em {data_pagamento}. Obrigado!',
        'Seu acesso continua ativo até **{expira_em}**. A próxima mensalidade vence em {proximo_vencimento}.',
        'Suas faturas ficam em **Configurações → Minhas faturas**.',
      ].join('\n\n'),
      texto_botao: 'Acessar o sistema',
    },
  },
};

export const TIPOS_EMAIL = Object.keys(CATALOGO_EMAILS) as TipoEmail[];

/** Variáveis de exemplo (pré-visualização e "enviar teste"). */
export function variaveisDeExemplo(tipo: TipoEmail): Record<string, string> {
  return Object.fromEntries(CATALOGO_EMAILS[tipo].variaveis.map((v) => [v.nome, v.exemplo]));
}
