import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { InlineError, errorMessage } from '@/components/InlineError';
import { ApiError, clearToken, me, roleLabel, type PublicUser } from '@/lib/api';

export type AppSession = { user: PublicUser };

export function AppLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['me'],
    queryFn: me,
    retry: false,
  });
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;

  useEffect(() => {
    if (!unauthorized) {
      return;
    }
    clearToken();
  }, [unauthorized]);

  if (session.isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Carregando sessão...</main>;
  }

  if (unauthorized) {
    return <Navigate to="/entrar" replace />;
  }

  if (session.isError || !session.data) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <InlineError
          message={errorMessage(session.error, 'Não foi possível carregar a sessão agora.')}
          onRetry={() => void session.refetch()}
        />
      </main>
    );
  }

  const user = session.data;

  function logout() {
    clearToken();
    queryClient.removeQueries({ queryKey: ['me'] });
    navigate('/entrar');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <NavLink to="/" className="text-base font-semibold">
              Casa de Leilões
            </NavLink>
            <nav className="flex flex-wrap gap-4 text-sm">
              <NavLink to="/" end className={navClass}>
                Vitrine
              </NavLink>
              {user.role === 'SELLER' ? (
                <NavLink to="/painel" className={navClass}>
                  Painel
                </NavLink>
              ) : (
                <NavLink to="/carteira" className={navClass}>
                  Carteira
                </NavLink>
              )}
              <NavLink to="/sessao" className={navClass}>
                Conta
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <p className="text-sm text-muted-foreground">
              {user.name} · {roleLabel(user.role)}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={logout}>
              Sair
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
        <Outlet context={{ user } satisfies AppSession} />
      </main>
    </div>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground';
}
