import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Lock, PiggyBank, Wallet, type LucideIcon } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { InlineError, errorMessage } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { deposit, getWallet } from '@/lib/api';
import { centsToInput, formatCents, parseReais } from '@/lib/format';
import { cn } from '@/lib/utils';

const QUICK_DEPOSITS = [5_000, 10_000, 50_000, 100_000];

export function WalletPage() {
  const { user } = useOutletContext<AppSession>();
  if (user.role !== 'BIDDER') {
    return (
      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Carteira</CardTitle>
          <CardDescription>O leiloeiro não deposita saldo nem dá lances.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/painel">Ir ao painel</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <BidderWallet />;
}

function BidderWallet() {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: ({ signal }) => getWallet(signal) });
  const [amount, setAmount] = useState('100,00');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const send = useMutation({
    mutationFn: deposit,
    onSuccess: async (_view, cents) => {
      setSuccess(`Depósito de ${formatCents(cents)} registrado.`);
      setFormError('');
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess('');
    const cents = parseReais(amount);
    if (cents === null) {
      setFormError('Informe um valor em reais, por exemplo 100,00.');
      return;
    }
    setFormError('');
    try {
      await send.mutateAsync(cents);
    } catch (caught) {
      setFormError(errorMessage(caught, 'Não foi possível depositar.'));
    }
  }

  const parsed = parseReais(amount);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Carteira</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          O comprometido é a soma dos lances em que você lidera agora. Se alguém cobrir seu lance, o valor volta na hora
          para o disponível. O débito só acontece quando você arremata.
        </p>
      </div>
      {wallet.isError ? (
        <InlineError
          message={errorMessage(wallet.error, 'Não foi possível carregar a carteira.')}
          onRetry={() => void wallet.refetch()}
        />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Balance
          label="Saldo total"
          hint="Depósitos menos arremates pagos"
          icon={Wallet}
          cents={wallet.data?.balanceCents}
          failed={wallet.isError}
        />
        <Balance
          label="Comprometido"
          hint="Em lotes que você lidera"
          icon={Lock}
          cents={wallet.data?.committedCents}
          failed={wallet.isError}
        />
        <Balance
          label="Disponível"
          hint="Pode cobrir um lance novo"
          icon={CircleCheck}
          cents={wallet.data?.availableCents}
          failed={wallet.isError}
          highlight
        />
      </div>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PiggyBank className="size-5 text-muted-foreground" aria-hidden="true" />
            Depósito simulado
          </CardTitle>
          <CardDescription>Nada é cobrado de verdade. O valor entra no saldo total na hora.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="deposit">Valor</Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                  R$
                </span>
                <Input
                  id="deposit"
                  inputMode="decimal"
                  autoComplete="off"
                  className="h-11 pl-10 text-base tabular-nums"
                  value={amount}
                  aria-invalid={formError ? true : undefined}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                {QUICK_DEPOSITS.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn('tabular-nums', parsed === value && 'border-primary bg-muted')}
                    onClick={() => setAmount(centsToInput(value))}
                  >
                    {formatCents(value)}
                  </Button>
                ))}
              </div>
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            {success ? (
              <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm font-medium text-success" role="status">
                {success}
              </p>
            ) : null}
            <Button type="submit" className="self-start" disabled={send.isPending}>
              {send.isPending ? 'Depositando...' : parsed === null ? 'Depositar' : `Depositar ${formatCents(parsed)}`}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Balance({
  label,
  hint,
  icon: Icon,
  cents,
  failed,
  highlight = false,
}: {
  label: string;
  hint: string;
  icon: LucideIcon;
  cents: number | undefined;
  failed: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className={cn(highlight && 'border-primary/40 ring-1 ring-primary/20')}>
      <CardContent className="flex flex-col gap-1 p-5 sm:p-5">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </p>
        {cents === undefined ? (
          failed ? (
            <p className="text-2xl font-semibold text-muted-foreground">—</p>
          ) : (
            <Skeleton className="my-1 h-8 w-32" />
          )
        ) : (
          <p className={cn('text-2xl font-semibold tabular-nums', highlight && 'text-primary')}>{formatCents(cents)}</p>
        )}
        <p className="text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}
