import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '@/components/AppLayout';
import { errorMessage } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { login } from '@/lib/api';
import { adoptSession, safeLotPath } from '@/lib/session';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const result = await login({ email, password });
      await adoptSession(queryClient, result.accessToken);
      navigate(safeLotPath(location.state));
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível entrar.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Entrar</h1>
        <p className="text-sm text-muted-foreground">Acesse a casa de leilões com o seu e-mail.</p>
      </div>
      <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            className="h-11"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Senha</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            className="h-11"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Entrando...' : 'Entrar'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Ainda não tem conta?{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/cadastro" state={location.state}>
            Cadastre-se
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
