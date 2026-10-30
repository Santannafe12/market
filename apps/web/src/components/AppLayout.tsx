import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gavel, LayoutGrid, LogIn, LogOut, PanelsTopLeft, Trophy, UserRound, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { InlineError, errorMessage } from '@/components/InlineError';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, clearToken, getToken, me, roleLabel, type PublicUser } from '@/lib/api';
import { discardPrivateCache, endSession } from '@/lib/session';
import { cn } from '@/lib/utils';

export type AppSession = { user: PublicUser };

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

export function AppLayout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => me(signal),
    retry: false,
  });
  const unauthorized = session.error instanceof ApiError && session.error.status === 401;

  useEffect(() => {
    if (!unauthorized) {
      return;
    }
    clearToken();
    void discardPrivateCache(queryClient, true);
  }, [unauthorized, queryClient]);

  if (session.isPending) {
    return (
      <Shell header={<Skeleton className="h-8 w-24 sm:w-40" />}>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </Shell>
    );
  }

  if (unauthorized) {
    return <Navigate to="/entrar" replace />;
  }

  if (session.isError || !session.data) {
    return (
      <Shell header={<ThemeToggle />}>
        <InlineError
          message={errorMessage(session.error, 'Não foi possível carregar a sessão agora.')}
          onRetry={() => void session.refetch()}
        />
      </Shell>
    );
  }

  const user = session.data;
  const items: NavItem[] = [
    { to: '/', label: 'Vitrine', icon: LayoutGrid, end: true },
    ...(user.role === 'SELLER'
      ? [{ to: '/painel', label: 'Painel', icon: PanelsTopLeft }]
      : [
          { to: '/carteira', label: 'Carteira', icon: Wallet },
          { to: '/arremates', label: 'Meus arremates', icon: Trophy },
        ]),
    { to: '/sessao', label: 'Conta', icon: UserRound },
  ];

  async function logout() {
    await endSession(queryClient);
    navigate('/entrar');
  }

  return (
    <Shell
      nav={items}
      header={
        <>
          <div className="hidden text-right leading-tight lg:block">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-xs text-muted-foreground">
              {roleLabel(user.role)} · {user.publicId}
            </p>
          </div>
          <ThemeToggle />
          <Button type="button" variant="outline" size="sm" onClick={logout} aria-label="Sair">
            <LogOut />
            <span className="hidden sm:inline">Sair</span>
          </Button>
        </>
      }
    >
      <Outlet context={{ user } satisfies AppSession} />
    </Shell>
  );
}

/** Header for pages a visitor can open without a session: a lot, its audit and a receipt. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const from = location.pathname.startsWith('/lotes/') ? location.pathname : null;
  const signedIn = Boolean(getToken());
  return (
    <Shell
      header={
        <>
          <ThemeToggle />
          <Button asChild variant={signedIn ? 'outline' : 'default'} size="sm">
            {signedIn ? (
              <Link to="/">
                <LayoutGrid />
                Vitrine
              </Link>
            ) : (
              <Link to="/entrar" state={from ? { from } : undefined}>
                <LogIn />
                Entrar
              </Link>
            )}
          </Button>
        </>
      }
    >
      {children}
    </Shell>
  );
}

/** Login and sign-up: a short pitch on wide screens, the form alone on a phone. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <span className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary-foreground/10">
            <Gavel className="size-5" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-semibold">Casa de Leilões</span>
        </span>
        <div className="flex max-w-md flex-col gap-6">
          <p className="font-display text-4xl font-semibold leading-tight">
            Livros raros, lances ao vivo e um histórico que qualquer pessoa pode auditar.
          </p>
          <ul className="flex flex-col gap-3 text-sm text-primary-foreground/80">
            <li>Lances em tempo real, com prorrogação nos dois minutos finais.</li>
            <li>Carteira com saldo simulado: o valor só é debitado quando você arremata.</li>
            <li>Comprovante público e auditoria assinada de cada lote.</li>
          </ul>
        </div>
        <p className="text-xs text-primary-foreground/60">Fichas e capas da Open Library.</p>
      </aside>
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-4 sm:px-8">
          <Link to="/" className="rounded-md lg:invisible">
            <Brand />
          </Link>
          <ThemeToggle />
        </div>
        <main className="flex flex-1 items-center justify-center px-4 pb-12 sm:px-8">
          <div className="w-full max-w-md">{children}</div>
        </main>
      </div>
    </div>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Gavel className="size-5" aria-hidden="true" />
      </span>
      <span className="whitespace-nowrap font-display text-lg font-semibold tracking-tight">Casa de Leilões</span>
    </span>
  );
}

function Shell({ header, nav = [], children }: { header: ReactNode; nav?: NavItem[]; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4">
          <Link to="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Brand />
          </Link>
          {nav.length > 0 ? (
            <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
              {nav.map((item) => (
                <NavItemLink key={item.to} item={item} />
              ))}
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-2">{header}</div>
        </div>
        {nav.length > 0 ? (
          <nav
            className="flex gap-1 overflow-x-auto border-t border-border px-3 py-2 [scrollbar-width:none] md:hidden [&_a]:px-2.5 [&_svg]:hidden min-[420px]:[&_svg]:block"
            aria-label="Principal"
          >
            {nav.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </nav>
        ) : null}
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-border">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-muted-foreground">
          Casa de Leilões · lances com saldo simulado · fichas e capas da Open Library, guardadas no momento da publicação.
        </p>
      </footer>
    </div>
  );
}

function NavItemLink({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex shrink-0 items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors',
          isActive ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
        )
      }
    >
      <Icon className="size-4" aria-hidden="true" />
      {item.label}
    </NavLink>
  );
}
