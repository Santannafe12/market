import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { InlineError, errorMessage } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, deposit, getWallet } from '@/lib/api';
import { formatCents, parseCents } from '@/lib/format';

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
  const [amount, setAmount] = useState('1000');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const send = useMutation({
    mutationFn: deposit,
    onSuccess: async () => {
      setSuccess('Depósito registrado.');
      setFormError('');
      await queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess('');
    const cents = parseCents(amount);
    if (cents === null) {
      setFormError('Informe um valor inteiro em centavos, de 1 até 2000000000.');
      return;
    }
    setFormError('');
    try {
      await send.mutateAsync(cents);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Não foi possível depositar.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Carteira</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O saldo comprometido é a soma dos lances em que você lidera. O disponível é o que ainda pode
          cobrir um lance novo.
        </p>
      </div>
      {wallet.isPending ? <p className="text-sm text-muted-foreground">Carregando saldos...</p> : null}
      {wallet.isError ? (
        <InlineError
          message={errorMessage(wallet.error, 'Não foi possível carregar a carteira.')}
          onRetry={() => void wallet.refetch()}
        />
      ) : null}
      {wallet.data ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Balance label="Saldo total" cents={wallet.data.balanceCents} />
          <Balance label="Comprometido" cents={wallet.data.committedCents} />
          <Balance label="Disponível" cents={wallet.data.availableCents} />
        </div>
      ) : null}
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Depósito fictício</CardTitle>
          <CardDescription>100 centavos equivalem a R$ 1,00. Nada é cobrado de verdade.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={onSubmit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="deposit">Valor (centavos)</Label>
              <Input
                id="deposit"
                inputMode="numeric"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                required
              />
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            {success ? (
              <p className="text-sm" role="status">
                {success}
              </p>
            ) : null}
            <Button type="submit" disabled={send.isPending}>
              {send.isPending ? 'Depositando...' : 'Depositar'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Balance({ label, cents }: { label: string; cents: number }) {
  return (
    <Card>
      <CardHeader className="p-4">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-xl">{formatCents(cents)}</CardTitle>
      </CardHeader>
    </Card>
  );
}
