/**
 * Autenticação no front: dois tokens independentes (clínica e super admin).
 *
 *   const { tokenClinica, entrarClinica, sairClinica, tokenAdmin, entrarAdmin, sairAdmin } = useAuth();
 */
import { createContext, useCallback, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { sessao } from '@/api/sessao';

type ValorAuth = {
  tokenClinica: string | null;
  tokenAdmin: string | null;
  entrarClinica: (token: string) => void;
  sairClinica: () => void;
  entrarAdmin: (token: string) => void;
  sairAdmin: () => void;
};

const AuthContext = createContext<ValorAuth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const estado = useSyncExternalStore(sessao.assinar, sessao.obter);
  const queryClient = useQueryClient();

  const entrarClinica = useCallback(
    (token: string) => {
      queryClient.clear();
      sessao.definir('clinica', token);
    },
    [queryClient],
  );
  const sairClinica = useCallback(() => {
    sessao.definir('clinica', null);
    queryClient.clear();
  }, [queryClient]);
  const entrarAdmin = useCallback(
    (token: string) => {
      queryClient.removeQueries({ queryKey: ['admin'] });
      sessao.definir('admin', token);
    },
    [queryClient],
  );
  const sairAdmin = useCallback(() => {
    sessao.definir('admin', null);
    queryClient.removeQueries({ queryKey: ['admin'] });
  }, [queryClient]);

  const valor = useMemo(
    () => ({
      tokenClinica: estado.clinica,
      tokenAdmin: estado.admin,
      entrarClinica,
      sairClinica,
      entrarAdmin,
      sairAdmin,
    }),
    [estado, entrarClinica, sairClinica, entrarAdmin, sairAdmin],
  );

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): ValorAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  return ctx;
}
