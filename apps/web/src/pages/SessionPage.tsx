import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { roleLabel } from '@/lib/api';
import { endSession } from '@/lib/session';

export function SessionPage() {
  const { user } = useOutletContext<AppSession>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function logout() {
    await endSession(queryClient);
    navigate('/entrar');
  }

  return (
    <Card className="max-w-lg">
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
        <Button className="self-start" type="button" variant="outline" onClick={logout}>
          Sair
        </Button>
      </CardContent>
    </Card>
  );
}
