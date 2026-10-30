import { useQueryClient } from '@tanstack/react-query';
import { LogOut, UserRound } from 'lucide-react';
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

  const rows = [
    ['Nome', user.name],
    ['E-mail', user.email],
    ['Papel', roleLabel(user.role)],
    ['Identificador público', user.publicId],
  ];

  return (
    <Card className="w-full max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
          Sua conta
        </CardTitle>
        <CardDescription>
          Você continua conectado depois de recarregar a página. Auditoria e comprovantes mostram só o identificador
          público.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="flex flex-col gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0 sm:flex-row sm:justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className={label === 'Identificador público' ? 'font-mono' : 'break-all'}>{value}</dd>
            </div>
          ))}
        </dl>
        <Button className="self-start" type="button" variant="outline" onClick={logout}>
          <LogOut />
          Sair
        </Button>
      </CardContent>
    </Card>
  );
}
