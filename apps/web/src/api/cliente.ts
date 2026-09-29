/**
 * Cliente HTTP da aplicação.
 *
 *   import { api } from '@/api/cliente';
 *   const lista = await api.get<Paciente[]>('/pacientes', { busca: 'ana' });
 *   await api.post('/pacientes', dados);
 *   await api.upload(`/prontuario/pacientes/${id}/anexos`, formData);
 *   const blob = await api.baixar(`/prontuario/anexos/${id}/download`);
 *
 * - Caminhos são os da API (sem /api): o prefixo é adicionado aqui (proxy do Vite em dev).
 * - Token: rotas que começam com /admin usam o token do super admin; as demais, o da clínica.
 * - 401 → limpa a sessão correspondente e redireciona para o login certo.
 * - 403 limite_atingido / recurso_indisponivel / assinatura_inativa → toast com a mensagem
 *   (de upgrade) automaticamente; o erro ainda é lançado para a tela tratar se quiser.
 * - Erros viram ErroApi { status, codigo, mensagem, dados }.
 */
import { toast } from 'sonner';
import { sessao, type TipoSessao } from './sessao';

const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '/api';

export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
    public readonly dados: Record<string, unknown> = {},
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }

  /** Mensagem pronta para exibir (pt-BR). */
  get mensagem(): string {
    return this.message;
  }

  /** Detalhes de validação do backend: [{ campo, mensagem }]. */
  get detalhes(): { campo: string; mensagem: string }[] {
    return (this.dados.detalhes as { campo: string; mensagem: string }[] | undefined) ?? [];
  }
}

export type Parametros = Record<string, string | number | boolean | null | undefined>;

type Opcoes = {
  metodo?: string;
  corpo?: unknown;
  parametros?: Parametros;
  /** Força qual token usar (padrão: automático pelo caminho). */
  sessao?: TipoSessao | 'nenhuma';
  /** Não mostrar toast automático de limite/assinatura. */
  silencioso?: boolean;
  resposta?: 'json' | 'blob';
  sinal?: AbortSignal;
};

const CODIGOS_COM_TOAST = new Set(['limite_atingido', 'recurso_indisponivel', 'assinatura_inativa']);

function montarUrl(caminho: string, parametros?: Parametros): string {
  const url = `${BASE_URL}${caminho.startsWith('/') ? caminho : `/${caminho}`}`;
  if (!parametros) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

function sessaoDoCaminho(caminho: string): TipoSessao {
  return caminho.startsWith('/admin') ? 'admin' : 'clinica';
}

async function requisitar<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const tipoSessao = opcoes.sessao ?? sessaoDoCaminho(caminho);
  const token = tipoSessao === 'nenhuma' ? null : sessao.token(tipoSessao);
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (opcoes.corpo instanceof FormData) {
    body = opcoes.corpo;
  } else if (opcoes.corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opcoes.corpo);
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  let resposta: Response;
  try {
    resposta = await fetch(montarUrl(caminho, opcoes.parametros), {
      method: opcoes.metodo ?? 'GET',
      headers,
      body,
      signal: opcoes.sinal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErroApi(0, 'sem_conexao', 'Não foi possível conectar ao servidor. Verifique sua conexão.');
  }

  if (resposta.ok) {
    if (resposta.status === 204) return undefined as T;
    if (opcoes.resposta === 'blob') return (await resposta.blob()) as T;
    const texto = await resposta.text();
    return (texto ? JSON.parse(texto) : undefined) as T;
  }

  let dados: Record<string, unknown> = {};
  try {
    dados = await resposta.json();
  } catch {
    /* resposta sem JSON */
  }
  const codigo = typeof dados.erro === 'string' ? dados.erro : 'erro';
  const mensagem = typeof dados.mensagem === 'string' ? dados.mensagem : 'Ocorreu um erro inesperado.';
  const erro = new ErroApi(resposta.status, codigo, mensagem, dados);

  if (resposta.status === 401 && token && tipoSessao !== 'nenhuma') {
    sessao.definir(tipoSessao, null);
    const destino = tipoSessao === 'admin' ? '/admin/login' : '/login';
    if (!window.location.pathname.startsWith(destino)) {
      toast.error('Sua sessão expirou. Faça login novamente.');
      window.location.assign(destino);
    }
  } else if (resposta.status === 403 && CODIGOS_COM_TOAST.has(codigo) && !opcoes.silencioso) {
    toast.error(codigo === 'assinatura_inativa' ? 'Assinatura inativa' : 'Limite do plano', {
      description: mensagem,
      duration: 8000,
    });
  }
  throw erro;
}

export const api = {
  get: <T>(caminho: string, parametros?: Parametros, opcoes: Omit<Opcoes, 'parametros'> = {}) =>
    requisitar<T>(caminho, { ...opcoes, parametros }),
  post: <T>(caminho: string, corpo?: unknown, opcoes: Opcoes = {}) =>
    requisitar<T>(caminho, { ...opcoes, metodo: 'POST', corpo }),
  put: <T>(caminho: string, corpo?: unknown, opcoes: Opcoes = {}) =>
    requisitar<T>(caminho, { ...opcoes, metodo: 'PUT', corpo }),
  patch: <T>(caminho: string, corpo?: unknown, opcoes: Opcoes = {}) =>
    requisitar<T>(caminho, { ...opcoes, metodo: 'PATCH', corpo }),
  delete: <T>(caminho: string, opcoes: Opcoes = {}) => requisitar<T>(caminho, { ...opcoes, metodo: 'DELETE' }),
  upload: <T>(caminho: string, formData: FormData, opcoes: Opcoes = {}) =>
    requisitar<T>(caminho, { ...opcoes, metodo: 'POST', corpo: formData }),
  baixar: (caminho: string, parametros?: Parametros) =>
    requisitar<Blob>(caminho, { parametros, resposta: 'blob' }),
};

/** Mensagem amigável de qualquer erro (para toasts em onError). */
export function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroApi) return erro.mensagem;
  if (erro instanceof Error) return erro.message;
  return 'Ocorreu um erro inesperado.';
}

