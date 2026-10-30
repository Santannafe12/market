import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/auth/RequireAuth';
import { AppLayout } from '@/components/AppLayout';
import { AuctionDetailPage } from '@/pages/AuctionDetailPage';
import { LoginPage } from '@/pages/LoginPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { SellerPanelPage } from '@/pages/SellerPanelPage';
import { SessionPage } from '@/pages/SessionPage';
import { ShowcasePage } from '@/pages/ShowcasePage';

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
          <Route
            element={
              <RequireAuth>
                <AppLayout />
              </RequireAuth>
            }
          >
            <Route path="/" element={<ShowcasePage />} />
            <Route path="/lotes/:auctionId" element={<AuctionDetailPage />} />
            <Route path="/painel" element={<SellerPanelPage />} />
            <Route path="/sessao" element={<SessionPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
