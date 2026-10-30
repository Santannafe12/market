import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Gavel, PanelsTopLeft } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthShell } from '@/components/AppLayout';
import { errorMessage } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { register, Role } from '@/lib/api';
import { adoptSession, safeLotPath } from '@/lib/session';
import { cn } from '@/lib/utils';

const roles: Array<{ value: Role; title: string; text: string; icon: typeof Gavel }> = [
  { value: 'BIDDER', title: 'Licitante', text: 'Deposita saldo simulado e dá lances.', icon: Gavel },
  { value: 'SELLER', title: 'Leiloeiro', text: 'Publica lotes e acompanha o resultado.', icon: PanelsTopLeft },
];

export function RegisterPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('BIDDER');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const result = await register({ name, email, password, role });
      await adoptSession(queryClient, result.accessToken);
      navigate(safeLotPath(location.state));
    } catch (caught) {
      setError(errorMessage(caught, 'Não foi possível cadastrar.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthShell>
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted-foreground">Escolha se você vai leiloar ou licitar. O papel não muda depois.</p>
      </div>
      <form className="mt-8 flex flex-col gap-4" onSubmit={onSubmit}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">Papel</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((option) => {
              const Icon = option.icon;
              const selected = role === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                    selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted',
                  )}
                >
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    className="sr-only"
                    checked={selected}
                    onChange={() => setRole(option.value)}
                  />
                  <Icon className={cn('mt-0.5 size-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} aria-hidden="true" />
                  <span>
                    <span className="block text-sm font-medium">{option.title}</span>
                    <span className="block text-xs text-muted-foreground">{option.text}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Nome</Label>
          <Input
            id="name"
            autoComplete="name"
            className="h-11"
            minLength={2}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
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
            autoComplete="new-password"
            className="h-11"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">Pelo menos 8 caracteres.</p>
        </div>
        {error ? (
          <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? 'Cadastrando...' : 'Cadastrar'}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Já tem conta?{' '}
          <Link className="font-medium text-foreground underline underline-offset-4" to="/entrar" state={location.state}>
            Entrar
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
