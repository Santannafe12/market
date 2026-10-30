import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, getAuction, getWallet, listBids, placeBid, type PublicAuction, type PublicBid } from '@/lib/api';
import { formatCents, formatWhen, parseCents } from '@/lib/format';

export function AuctionDetailPage() {
  const { auctionId } = useParams();
  const { user } = useOutletContext<AppSession>();
  const auction = useQuery({
    queryKey: ['auction', auctionId],
    queryFn: () => getAuction(auctionId ?? ''),
    enabled: Boolean(auctionId),
  });

  if (!auctionId || auction.isPending) {
    return <p className="text-sm text-muted-foreground">Carregando lote...</p>;
  }

  if (auction.isError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <InlineError
          message={errorMessage(auction.error, 'Não foi possível abrir este lote.')}
          onRetry={() => void auction.refetch()}
        />
        <Link className="text-sm font-medium underline" to="/">
          Voltar à vitrine
        </Link>
      </div>
    );
  }

  const lot = auction.data;
  const facts = [
    ['Autores', lot.authors.length > 0 ? lot.authors.join(', ') : 'Não informado'],
    ['Editora', lot.publisher ?? 'Não informada'],
    ['Publicação', lot.publishedDate ?? 'Não informada'],
    ['Ano', lot.publishedYear ? String(lot.publishedYear) : 'Não informado'],
    ['ISBN', lot.isbn ?? 'Não informado'],
    ['Idioma', lot.language ?? 'Não informado'],
    ['Leiloeiro', lot.sellerPublicId],
    ['Lance inicial', formatCents(lot.startingBidCents)],
    ['Incremento mínimo', formatCents(lot.minIncrementCents)],
    ['Lance atual', lot.currentBidCents === null ? 'Ainda sem lances' : formatCents(lot.currentBidCents)],
    ['Lances', String(lot.bidCount)],
    ['Início', formatWhen(lot.startsAt)],
    ['Fim', formatWhen(lot.endsAt)],
  ];
  if (lot.originalEndsAt !== lot.endsAt) {
    facts.splice(facts.length - 1, 0, ['Fim original', formatWhen(lot.originalEndsAt)]);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm font-medium text-muted-foreground underline" to="/">
        Voltar à vitrine
      </Link>
      <article className="grid gap-6 md:grid-cols-[220px_1fr]">
        <Cover auction={lot} className="aspect-[2/3] w-full rounded-lg md:max-w-[220px]" />
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{lot.title}</h1>
            <StatusBadge status={lot.displayStatus} />
            <Link className="text-sm font-medium underline" to={`/auditoria/${auctionId}`}>
              Auditoria pública
            </Link>
          </div>
          {lot.description ? <p className="text-sm leading-6">{lot.description}</p> : null}
          <dl className="grid gap-3 sm:grid-cols-2">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </article>
      {user.role === 'BIDDER' ? <BidPanel auctionId={auctionId} lot={lot} publicId={user.publicId} /> : (
        <p className="text-sm text-muted-foreground">O leiloeiro não pode dar lances.</p>
      )}
    </div>
  );
}

function BidPanel({
  auctionId,
  lot,
  publicId,
}: {
  auctionId: string;
  lot: PublicAuction;
  publicId: string;
}) {
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: getWallet });
  const bids = useQuery({ queryKey: ['bids', auctionId], queryFn: () => listBids(auctionId) });
  const minimum = nextMinimum(lot);
  const [amount, setAmount] = useState(minimum === null ? '' : String(minimum));
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const send = useMutation({ mutationFn: (cents: number) => placeBid(auctionId, cents) });
  const standing = bidStanding(publicId, lot, bids.data ?? []);

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
      const result = await send.mutateAsync(cents);
      const extended = result.auction.endsAt !== lot.endsAt;
      setSuccess(extended ? 'Lance aceito. O fim do lote avançou 2 minutos.' : 'Lance aceito.');
      const next = nextMinimum(result.auction);
      setAmount(next === null ? '' : String(next));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auction', auctionId] }),
        queryClient.invalidateQueries({ queryKey: ['bids', auctionId] }),
        queryClient.invalidateQueries({ queryKey: ['wallet'] }),
      ]);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Não foi possível registrar o lance.');
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <Card>
        <CardHeader>
          <CardTitle>Dar um lance</CardTitle>
          <CardDescription>
            {minimum === null
              ? 'O próximo lance passaria do limite permitido.'
              : `Lance mínimo agora: ${formatCents(minimum)}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {standing === 'leading' ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm" role="status">
              Você está ganhando.
            </p>
          ) : null}
          {standing === 'outbid' ? (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm" role="status">
              Você foi superado.
            </p>
          ) : null}
          {lot.status === 'OPEN' ? (
            <form className="flex flex-col gap-4" onSubmit={onSubmit}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="bid">Seu lance (centavos)</Label>
                <Input
                  id="bid"
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
              <Button type="submit" disabled={send.isPending || minimum === null}>
                {send.isPending ? 'Enviando...' : 'Enviar lance'}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Este lote não aceita mais lances.</p>
          )}
          <BidHistory bids={bids.data} pending={bids.isPending} error={bids.error} onRetry={() => void bids.refetch()} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Sua carteira</CardTitle>
          <CardDescription>
            <Link className="underline" to="/carteira">
              Depositar
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {wallet.isPending ? <p className="text-muted-foreground">Carregando saldos...</p> : null}
          {wallet.isError ? (
            <InlineError
              message={errorMessage(wallet.error, 'Não foi possível carregar a carteira.')}
              onRetry={() => void wallet.refetch()}
            />
          ) : null}
          {wallet.data ? (
            <>
              <p>
                <span className="text-muted-foreground">Total: </span>
                {formatCents(wallet.data.balanceCents)}
              </p>
              <p>
                <span className="text-muted-foreground">Comprometido: </span>
                {formatCents(wallet.data.committedCents)}
              </p>
              <p>
                <span className="text-muted-foreground">Disponível: </span>
                {formatCents(wallet.data.availableCents)}
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BidHistory({
  bids,
  pending,
  error,
  onRetry,
}: {
  bids: PublicBid[] | undefined;
  pending: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (pending) {
    return <p className="text-sm text-muted-foreground">Carregando lances...</p>;
  }
  if (error) {
    return <InlineError message={errorMessage(error, 'Não foi possível carregar os lances.')} onRetry={onRetry} />;
  }
  if (!bids || bids.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum lance registrado.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {bids.map((bid) => (
        <li key={bid.sequence} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>
            #{bid.sequence} · {bid.bidderPublicId}
          </span>
          <span>
            {formatCents(bid.amountCents)} · {formatWhen(bid.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}

function nextMinimum(lot: PublicAuction) {
  if (lot.currentBidCents === null) {
    return lot.startingBidCents;
  }
  const next = lot.currentBidCents + lot.minIncrementCents;
  return next > 2_000_000_000 ? null : next;
}

function bidStanding(publicId: string, lot: PublicAuction, bids: PublicBid[]) {
  if (lot.currentLeaderPublicId === publicId) {
    return 'leading' as const;
  }
  if (bids.some((bid) => bid.bidderPublicId === publicId)) {
    return 'outbid' as const;
  }
  return null;
}
