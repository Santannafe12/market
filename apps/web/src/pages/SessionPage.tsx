import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError, clearToken, me, roleLabel } from '@/lib/api';

export function SessionPage() {
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

  useEffect(() => {
    return () => {
      queryClient.removeQueries({ queryKey: ['me'] });
    };
  }, [queryClient]);

  if (session.isPending) {
    return <main className="p-8 text-sm text-muted-foreground">Carregando sessão...</main>;
  }

  if (unauthorized) {
    return <Navigate to="/entrar" replace />;
  }

  if (session.isError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Sessão indisponível</CardTitle>
            <CardDescription>
              Não foi possível carregar a sessão agora. Sua entrada continua salva.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => void session.refetch()} disabled={session.isFetching}>
              {session.isFetching ? 'Tentando novamente...' : 'Tentar novamente'}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const user = session.data;

  function logout() {
    clearToken();
    navigate('/entrar');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Sua sessão</CardTitle>
          <CardDescription>Você continua conectado depois de recarregar a página.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <p>
            <span className="text-muted-foreground">Nome: </span>
            {user.name}
          </p>
          <p>
            <span className="text-muted-foreground">E-mail: </span>
            {user.email}
          </p>
          <p>
            <span className="text-muted-foreground">Papel: </span>
            {roleLabel(user.role)}
          </p>
          <p>
            <span className="text-muted-foreground">Identificador público: </span>
            {user.publicId}
          </p>
          <Button type="button" variant="outline" onClick={logout}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
