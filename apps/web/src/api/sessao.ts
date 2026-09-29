/**
 * Armazenamento dos tokens (fora do React, para o cliente HTTP também acessar).
 * Dois tokens independentes: clínica e super admin — dá para estar logado nos dois.
 */
const CHAVE_CLINICA = 'sc.token.clinica';
const CHAVE_ADMIN = 'sc.token.admin';

export type TipoSessao = 'clinica' | 'admin';

type Estado = { clinica: string | null; admin: string | null };

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave);
  } catch {
    return null;
  }
}

let estado: Estado = { clinica: ler(CHAVE_CLINICA), admin: ler(CHAVE_ADMIN) };
const ouvintes = new Set<() => void>();

function emitir() {
  ouvintes.forEach((o) => o());
}

export const sessao = {
  obter(): Estado {
    return estado;
  },
  token(tipo: TipoSessao): string | null {
    return estado[tipo];
  },
  definir(tipo: TipoSessao, token: string | null) {
    const chave = tipo === 'clinica' ? CHAVE_CLINICA : CHAVE_ADMIN;
    try {
      if (token) localStorage.setItem(chave, token);
      else localStorage.removeItem(chave);
    } catch {
      /* armazenamento indisponível: mantém só em memória */
    }
    estado = { ...estado, [tipo]: token };
    emitir();
  },
  assinar(ouvinte: () => void): () => void {
    ouvintes.add(ouvinte);
    return () => ouvintes.delete(ouvinte);
  },
};

// Sincroniza entre abas.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === CHAVE_CLINICA || e.key === CHAVE_ADMIN) {
      estado = { clinica: ler(CHAVE_CLINICA), admin: ler(CHAVE_ADMIN) };
      emitir();
    }
  });
}
