import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/AppLayout';
import { AuctionDetailPage } from '@/pages/AuctionDetailPage';
import { AuditPage } from '@/pages/AuditPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { ParticipationsPage } from '@/pages/ParticipationsPage';
import { ReceiptPage } from '@/pages/ReceiptPage';
import { SellerPanelPage } from '@/pages/SellerPanelPage';
import { SessionPage } from '@/pages/SessionPage';
import { ShowcasePage } from '@/pages/ShowcasePage';
import { WalletPage } from '@/pages/WalletPage';
import { getToken } from '@/lib/api';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />
          <Route path="/auditoria/:auctionId" element={<AuditPage />} />
          <Route path="/comprovantes/:token" element={<ReceiptPage />} />
          <Route element={<LotAccess />}>
            <Route path="/lotes/:auctionId" element={<AuctionDetailPage />} />
          </Route>
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<ShowcasePage />} />
            <Route path="/painel" element={<SellerPanelPage />} />
            <Route path="/sessao" element={<SessionPage />} />
            <Route path="/carteira" element={<WalletPage />} />
            <Route path="/arremates" element={<ParticipationsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function LotAccess() {
  const location = useLocation();
  const from = location.pathname.startsWith('/lotes/') ? location.pathname : null;
  if (!getToken()) {
    return (
      <div className="min-h-screen">
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
            <span className="text-base font-semibold">Casa de Leilões</span>
            <Link className="text-sm font-medium underline" to="/entrar" state={from ? { from } : undefined}>
              Entrar
            </Link>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6">
          <Outlet context={{ user: null }} />
        </main>
      </div>
    );
  }

  return (
    <RequireAuth>
      <AppLayout />
    </RequireAuth>
  );
}
