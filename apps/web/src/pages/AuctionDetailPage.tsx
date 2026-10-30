import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CircleAlert,
  Gavel,
  History,
  LogIn,
  SearchX,
  ShieldCheck,
  Timer,
  TrendingDown,
  Trophy,
  Wallet,
} from 'lucide-react';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import {
  ROOM_REFRESH_MS,
  RoomSync,
  bidStanding,
  refreshRoom,
  type RoomState,
  type Standing,
} from '@realtime/auction-sync';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ApiError,
  getAuction,
  getWallet,
  listBids,
  placeBid,
  type PublicAuction,
  type PublicBid,
  type PublicUser,
} from '@/lib/api';
import { centsToInput, countdown, formatCents, formatRemaining, formatWhen, parseReais } from '@/lib/format';
import {
  disconnectRealtime,
  ensureRealtime,
  joinAuctionRoom,
  onAuctionUpdated,
  onRealtimeConnect,
  onRealtimeDisconnect,
  onWalletHint,
} from '@/lib/realtime';
import { cn } from '@/lib/utils';

type Viewer = PublicUser | null;
type LinkState = 'connecting' | 'online' | 'reconnecting' | 'offline';

const MONEY_MAX_CENTS = 2_000_000_000;
const ANTI_SNIPE_MS = 120_000;

export function AuctionDetailPage() {
  const { auctionId } = useParams();
  const { user } = useOutletContext<AppSession | { user: Viewer }>();
  const queryClient = useQueryClient();
  const syncRef = useRef(new RoomSync<PublicAuction>());
  const [room, setRoom] = useState<RoomState<PublicAuction> | null>(null);
  const [link, setLink] = useState<LinkState>('connecting');
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!auctionId) {
      return;
    }
    let stopped = false;
    const sync = new RoomSync<PublicAuction>();
    syncRef.current = sync;
    setRoom(null);
    setLoadError('');
    setLink('connecting');
    const controller = new AbortController();

    const load = async () => {
      const auction = await getAuction(auctionId, controller.signal);
      const bids = await listBids(auctionId, controller.signal);
      return { auction, bids, serverNow: auction.serverNow };
    };

    const publish = (before: number | null) => {
      const next = sync.current;
      setRoom(next);
      const after = next?.auction.version ?? null;
      if (user?.role === 'BIDDER' && before !== null && after !== null && after > before) {
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }
    };

    const refresh = async () => {
      const before = sync.current?.auction.version ?? null;
      try {
        await refreshRoom(sync, load);
        if (stopped) {
          return;
        }
        if (sync.current) {
          publish(before);
          setLoadError('');
        } else {
          setLoadError('Não foi possível abrir este lote.');
        }
      } catch (error) {
        if (stopped || isAbort(error)) {
          return;
        }
        if (!sync.current) {
          setLoadError(errorMessage(error, 'Não foi possível abrir este lote.'));
        }
      }
    };

    const open = async () => {
      try {
        await joinAuctionRoom(auctionId);
        if (stopped) {
          return;
        }
        setLink('online');
      } catch (error) {
        if (stopped || isAbort(error)) {
          return;
        }
        setLink('offline');
      }
      await refresh();
    };

    const unsubscribeConnect = onRealtimeConnect(() => {
      if (!stopped) {
        void open();
      }
    });
    const unsubscribeDisconnect = onRealtimeDisconnect(() => {
      if (!stopped) {
        setLink('reconnecting');
      }
    });
    const unsubscribeEvent = onAuctionUpdated((event) => {
      if (stopped || event.id !== auctionId) {
        return;
      }
      const before = sync.current?.auction.version ?? null;
      const kind = sync.noteEvent(event);
      if (kind === 'apply') {
        publish(before);
      }
      if (kind === 'refetch') {
        void refresh();
      }
    });
    const unsubscribeHint = onWalletHint(() => {
      if (!stopped && user?.role === 'BIDDER') {
        void queryClient.invalidateQueries({ queryKey: ['wallet'] });
      }
    });

    ensureRealtime();
    const fallback = window.setTimeout(() => {
      if (stopped) {
        return;
      }
      setLink((current) => (current === 'connecting' ? 'offline' : current));
      if (!sync.current) {
        void refresh();
      }
    }, 8_000);
    const interval = window.setInterval(() => {
      if (!stopped) {
        void refresh();
      }
    }, ROOM_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(fallback);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeConnect();
      unsubscribeDisconnect();
      unsubscribeEvent();
      unsubscribeHint();
      disconnectRealtime();
    };
  }, [auctionId, queryClient, reloadKey, user?.id, user?.role]);

  if (!auctionId) {
    return <EmptyState icon={SearchX} title="Lote não informado." />;
  }

  if (!room && loadError) {
    return (
      <div className="flex flex-col items-start gap-4">
        <InlineError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
        {user ? <BackLink /> : null}
      </div>
    );
  }

  if (!room) {
    return <RoomSkeleton />;
  }

  const lot = room.auction;
  const standing = bidStanding(user ? { publicId: user.publicId, role: user.role } : null, lot, room.bids);

  return (
    <div className="flex flex-col gap-6">
      {user ? <BackLink /> : null}
      <LotHeader lot={lot} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <aside className="flex flex-col gap-4 lg:order-2" aria-label="Lance">
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-4 border-b border-border bg-muted/40 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {lot.currentBidCents === null ? 'Lance inicial' : 'Lance atual'}
                  </p>
                  <p className="font-display text-4xl font-semibold tabular-nums tracking-tight">
                    {formatCents(lot.currentBidCents ?? lot.startingBidCents)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'} · incremento mínimo{' '}
                    {formatCents(lot.minIncrementCents)}
                  </p>
                </div>
                <StatusBadge status={lot.displayStatus} />
              </div>
              <Countdown lot={lot} serverNow={room.serverNow} />
            </div>
            <div className="flex flex-col gap-4 p-5">
              {lot.status === 'OPEN' ? <StandingBanner standing={standing} /> : null}
              <LotOutcome lot={lot} user={user} standing={standing} />
              {user?.role === 'BIDDER' ? (
                <BidForm
                  auctionId={auctionId}
                  bids={room.bids}
                  lot={lot}
                  serverNow={room.serverNow}
                  standing={standing}
                  syncRef={syncRef}
                  onRoom={setRoom}
                />
              ) : null}
              {!user && lot.status === 'OPEN' && lot.displayStatus !== 'ended' ? (
                <Button asChild size="lg" className="w-full">
                  <Link to="/entrar" state={{ from: `/lotes/${auctionId}` }}>
                    <LogIn />
                    Entrar para dar um lance
                  </Link>
                </Button>
              ) : null}
              <LinkStatus link={link} />
            </div>
          </Card>
          {user?.role === 'BIDDER' ? <WalletCard /> : null}
        </aside>
        <div className="flex min-w-0 flex-col gap-6 lg:order-1">
          <BidHistory bids={room.bids} lot={lot} viewer={user} />
          <LotDetails lot={lot} />
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
      to="/"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar à vitrine
    </Link>
  );
}

function LotHeader({ lot }: { lot: PublicAuction }) {
  const meta = [lot.publisher, lot.publishedYear, lot.isbn ? `ISBN ${lot.isbn}` : null].filter(Boolean).join(' · ');
  return (
    <section className="flex gap-4 sm:gap-6">
      <Cover auction={lot} className="aspect-[2/3] w-24 shrink-0 rounded-lg shadow-md sm:w-32 lg:w-36" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Sala do lote</p>
        <h1 className="break-words font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl lg:text-4xl">
          {lot.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          {lot.authors.length > 0 ? lot.authors.join(', ') : 'Autor não informado'}
        </p>
        {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
        <div className="mt-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/auditoria/${lot.id}`}>
              <ShieldCheck />
              Auditoria pública
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

const standingCopy: Record<Standing, { text: string; className: string; icon: typeof Trophy }> = {
  leading: { text: 'Você está ganhando.', className: 'border-success/40 bg-success/10 text-success', icon: Trophy },
  outbid: { text: 'Você foi superado.', className: 'border-warning/40 bg-warning/10 text-warning', icon: TrendingDown },
  watching: { text: 'Você ainda não deu lances.', className: 'border-border bg-muted text-foreground', icon: Gavel },
  visitor: {
    text: 'Você está acompanhando como visitante.',
    className: 'border-border bg-muted text-foreground',
    icon: Gavel,
  },
  seller: { text: 'O leiloeiro não pode dar lances.', className: 'border-border bg-muted text-foreground', icon: Gavel },
};

function StandingBanner({ standing }: { standing: Standing }) {
  const copy = standingCopy[standing];
  const Icon = copy.icon;
  return (
    <p className={cn('flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium', copy.className)} role="status">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {copy.text}
    </p>
  );
}

function LotOutcome({ lot, user, standing }: { lot: PublicAuction; user: Viewer; standing: Standing }) {
  if (lot.status === 'SETTLED') {
    const won = Boolean(user) && lot.currentLeaderPublicId === user?.publicId;
    return (
      <div
        className={cn(
          'flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm',
          won ? 'border-success/40 bg-success/10' : 'border-border bg-muted',
        )}
        role="status"
      >
        <p className={cn('flex items-center gap-2 font-medium', won && 'text-success')}>
          <Trophy className="size-4" aria-hidden="true" />
          {won ? 'Você arrematou este lote.' : 'Este lote foi arrematado.'}
        </p>
        {won ? (
          <Link className="font-medium underline underline-offset-4" to="/arremates">
            Ver o comprovante em Meus arremates
          </Link>
        ) : standing === 'outbid' ? (
          <p className="text-muted-foreground">Outro licitante venceu. Seu saldo não foi debitado.</p>
        ) : null}
      </div>
    );
  }
  if (lot.status === 'UNSOLD') {
    return <p className="rounded-lg border border-border bg-muted px-3 py-2.5 text-sm">Este lote encerrou sem lances.</p>;
  }
  if (lot.status === 'CANCELLED') {
    return (
      <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
        Este lote foi cancelado.
      </p>
    );
  }
  if (lot.displayStatus === 'ended') {
    return <p className="text-sm text-muted-foreground">O horário acabou. A liquidação acontece em instantes.</p>;
  }
  return null;
}

function Countdown({ lot, serverNow }: { lot: PublicAuction; serverNow: string }) {
  const offsetRef = useRef<{ stamp: string; offset: number } | null>(null);
  const [, setTick] = useState(0);
  if (offsetRef.current?.stamp !== serverNow) {
    offsetRef.current = { stamp: serverNow, offset: Date.parse(serverNow) - Date.now() };
  }
  useEffect(() => {
    const id = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (lot.status !== 'OPEN') {
    return (
      <p className="text-sm text-muted-foreground">
        Encerrado em <span className="font-medium text-foreground">{formatWhen(lot.endsAt)}</span>
      </p>
    );
  }
  const state = countdown(lot.startsAt, lot.endsAt, Date.now() + (offsetRef.current?.offset ?? 0));
  const closing = state.phase === 'ends' && state.ms <= ANTI_SNIPE_MS;
  const extended = lot.originalEndsAt !== lot.endsAt;
  const label = state.phase === 'starts' ? 'Começa em' : state.phase === 'ends' ? 'Encerra em' : 'Tempo esgotado';
  return (
    <div className="flex flex-col gap-2">
      <div
        className={cn(
          'flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3',
          closing && 'border-warning/50 bg-warning/10',
        )}
      >
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Timer className={cn('size-4', closing && 'text-warning')} aria-hidden="true" />
          {label}
        </span>
        <span className={cn('font-mono text-2xl font-semibold tabular-nums', closing && 'text-warning')}>
          {formatRemaining(state.ms)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {state.phase === 'starts' ? `Abre ${formatWhen(lot.startsAt)} · ` : null}
        Fim {formatWhen(lot.endsAt)}
        {extended ? ` · prorrogado (fim original ${formatWhen(lot.originalEndsAt)})` : null}
      </p>
      {closing ? (
        <p className="text-xs font-medium text-warning">Reta final: um lance agora prorroga o fim em 2 minutos.</p>
      ) : null}
    </div>
  );
}

function BidForm({
  auctionId,
  lot,
  bids,
  serverNow,
  standing,
  syncRef,
  onRoom,
}: {
  auctionId: string;
  lot: PublicAuction;
  bids: PublicBid[];
  serverNow: string;
  standing: Standing;
  syncRef: { current: RoomSync<PublicAuction> };
  onRoom: (room: RoomState<PublicAuction> | null) => void;
}) {
  const queryClient = useQueryClient();
  const minimum = nextMinimum(lot);
  const [amount, setAmount] = useState(minimum === null ? '' : centsToInput(minimum));
  const [formError, setFormError] = useState<{ text: string; wallet: boolean } | null>(null);
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const open = lot.status === 'OPEN' && lot.displayStatus !== 'ended';

  useEffect(() => {
    setFormError(null);
  }, [lot.version]);

  useEffect(() => {
    if (standing !== 'leading') {
      setSuccess('');
    }
  }, [standing]);

  useEffect(() => {
    if (minimum === null) {
      return;
    }
    setAmount((current) => {
      const parsed = parseReais(current);
      if (parsed === null || parsed < minimum) {
        return centsToInput(minimum);
      }
      return current;
    });
  }, [minimum]);

  if (!open) {
    return null;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess('');
    const cents = parseReais(amount);
    if (cents === null) {
      setFormError({ text: 'Informe um valor em reais, por exemplo 15,00.', wallet: false });
      return;
    }
    setFormError(null);
    setPending(true);
    let accepted = false;
    try {
      const result = await placeBid(auctionId, cents);
      accepted = true;
      const previousEndsAt = lot.endsAt;
      queryClient.setQueryData(['wallet'], result.wallet);
      setSuccess(
        result.auction.endsAt !== previousEndsAt
          ? `Lance de ${formatCents(cents)} aceito. O fim do lote avançou 2 minutos.`
          : `Lance de ${formatCents(cents)} aceito. Você está na liderança.`,
      );
      const next = nextMinimum(result.auction);
      setAmount(next === null ? '' : centsToInput(next));
      const known = syncRef.current.current?.bids ?? bids;
      const merged = known.some((bid) => bid.sequence === result.bid.sequence) ? known : [...known, result.bid];
      const before = syncRef.current.current?.auction.version ?? null;
      if (merged.length === result.auction.bidCount && (before === null || result.auction.version > before)) {
        const outcome = syncRef.current.noteSnapshot(result.auction, merged, result.auction.serverNow ?? serverNow);
        onRoom(syncRef.current.current);
        if (outcome.followUp === 'refetch') {
          const auction = await getAuction(auctionId);
          const freshBids = await listBids(auctionId);
          syncRef.current.noteSnapshot(auction, freshBids, auction.serverNow);
          onRoom(syncRef.current.current);
        }
      } else {
        const auction = await getAuction(auctionId);
        const freshBids = await listBids(auctionId);
        syncRef.current.noteSnapshot(auction, freshBids, auction.serverNow);
        onRoom(syncRef.current.current);
      }
    } catch (caught) {
      if (!accepted) {
        setFormError(bidRefusal(caught, lot));
      }
    } finally {
      setPending(false);
    }
  }

  const parsed = parseReais(amount);
  const quick =
    minimum === null
      ? []
      : [...new Set([minimum, minimum + lot.minIncrementCents, minimum + 5 * lot.minIncrementCents])].filter(
          (value) => value <= MONEY_MAX_CENTS,
        );

  return (
    <form className="flex flex-col gap-3" onSubmit={onSubmit} noValidate>
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor="bid">Seu lance</Label>
        <span className="text-xs text-muted-foreground">
          {minimum === null ? 'Limite de valor atingido' : `Mínimo ${formatCents(minimum)}`}
        </span>
      </div>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
          R$
        </span>
        <Input
          id="bid"
          inputMode="decimal"
          autoComplete="off"
          className="h-12 pl-10 text-lg font-semibold tabular-nums"
          value={amount}
          aria-invalid={formError ? true : undefined}
          aria-describedby={formError ? 'bid-error' : undefined}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      {quick.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Valores sugeridos">
          {quick.map((value) => (
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
      ) : null}
      {lot.displayStatus === 'scheduled' ? (
        <p className="text-xs text-muted-foreground">Os lances abrem em {formatWhen(lot.startsAt)}.</p>
      ) : null}
      {formError ? (
        <div
          id="bid-error"
          className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive"
          role="alert"
        >
          <p className="flex items-start gap-2">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {formError.text}
          </p>
          {formError.wallet ? (
            <Link className="pl-6 font-medium underline underline-offset-4" to="/carteira">
              Depositar na carteira
            </Link>
          ) : null}
        </div>
      ) : null}
      {success ? (
        <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm font-medium text-success" role="status">
          {success}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending || minimum === null}>
        <Gavel />
        {pending ? 'Enviando lance...' : parsed === null ? 'Dar lance' : `Dar lance de ${formatCents(parsed)}`}
      </Button>
    </form>
  );
}

/** Domain code first; the API text is the fallback for any code the client does not know. */
function bidRefusal(error: unknown, lot: PublicAuction) {
  if (!(error instanceof ApiError)) {
    return { text: 'Não foi possível registrar o lance. Verifique a conexão e tente de novo.', wallet: false };
  }
  const minimum = nextMinimum(lot);
  const text: Record<string, string> = {
    BID_BELOW_STARTING: `O primeiro lance precisa ser de pelo menos ${formatCents(lot.startingBidCents)}.`,
    BID_BELOW_INCREMENT:
      minimum === null
        ? error.message
        : `Lance abaixo do mínimo. Cubra o lance atual mais o incremento: ${formatCents(minimum)} ou mais.`,
    INSUFFICIENT_AVAILABLE_BALANCE: 'Saldo disponível insuficiente para este lance.',
    BID_LEADER_CANNOT_RAISE: 'Você já está ganhando este lote e não pode cobrir o próprio lance.',
    AUCTION_NOT_STARTED: `Este lote ainda não começou. Os lances abrem em ${formatWhen(lot.startsAt)}.`,
    AUCTION_ENDED: 'Este lote já encerrou e não aceita mais lances.',
    AUCTION_CANCELLED: 'Este lote foi cancelado pelo leiloeiro.',
    SELLER_CANNOT_BID: 'O leiloeiro não pode dar lances.',
    AMOUNT_OVERFLOW: 'Esse valor passa do limite permitido.',
    AMOUNT_INVALID: 'Informe um valor de pelo menos R$ 0,01.',
    AUCTION_INTEGRITY: 'A integridade deste lote não confere. Nenhum lance é aceito até a auditoria voltar a ficar íntegra.',
    CONFLICT_RETRY_EXHAUSTED: 'Muitos lances ao mesmo tempo. Tente de novo em instantes.',
  };
  return {
    text: (error.code ? text[error.code] : undefined) ?? error.message,
    wallet: error.code === 'INSUFFICIENT_AVAILABLE_BALANCE',
  };
}

function LinkStatus({ link }: { link: LinkState }) {
  const copy: Record<LinkState, { text: string; dot: string }> = {
    connecting: { text: 'Conectando à sala...', dot: 'bg-muted-foreground' },
    online: { text: 'Sala conectada. Lances aparecem sem recarregar.', dot: 'bg-success' },
    reconnecting: { text: 'Reconectando a sala...', dot: 'bg-warning' },
    offline: { text: 'Sem conexão com a sala. Os dados continuam vindo do servidor.', dot: 'bg-destructive' },
  };
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className={cn('size-2 shrink-0 rounded-full', copy[link].dot)} aria-hidden="true" />
      {copy[link].text}
    </p>
  );
}

function WalletCard() {
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: ({ signal }) => getWallet(signal) });
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
          Sua carteira
        </CardTitle>
        <Button asChild variant="outline" size="sm">
          <Link to="/carteira">Depositar</Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        {wallet.isPending ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-6 w-3/5" />
          </div>
        ) : null}
        {wallet.isError ? (
          <InlineError
            message={errorMessage(wallet.error, 'Não foi possível carregar a carteira.')}
            onRetry={() => void wallet.refetch()}
          />
        ) : null}
        {wallet.data ? (
          <dl className="flex flex-col gap-2">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="tabular-nums">{formatCents(wallet.data.balanceCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Comprometido</dt>
              <dd className="tabular-nums">{formatCents(wallet.data.committedCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-2">
              <dt className="font-medium">Disponível</dt>
              <dd className="text-base font-semibold tabular-nums">{formatCents(wallet.data.availableCents)}</dd>
            </div>
          </dl>
        ) : null}
        <Link className="text-xs text-muted-foreground underline underline-offset-4" to="/arremates">
          Ver meus arremates
        </Link>
      </CardContent>
    </Card>
  );
}

function BidHistory({ bids, lot, viewer }: { bids: PublicBid[]; lot: PublicAuction; viewer: Viewer }) {
  const newestFirst = [...bids].reverse();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="size-4 text-muted-foreground" aria-hidden="true" />
          Histórico de lances
        </CardTitle>
        <span className="hidden text-xs text-muted-foreground sm:inline">Participantes pelo identificador público</span>
      </CardHeader>
      <CardContent>
        {bids.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nenhum lance registrado.{' '}
            {lot.status === 'OPEN' && lot.displayStatus !== 'ended' ? 'O primeiro lance começa a disputa.' : null}
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {newestFirst.map((bid, index) => {
              const mine = viewer?.publicId === bid.bidderPublicId;
              const leader = index === 0 && lot.status !== 'CANCELLED';
              return (
                <li key={bid.sequence} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-8 shrink-0 text-xs tabular-nums text-muted-foreground">#{bid.sequence}</span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm">
                        <span className="truncate font-mono">{bid.bidderPublicId}</span>
                        {mine ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">você</span>
                        ) : null}
                        {leader ? (
                          <span className="rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
                            {lot.status === 'SETTLED' ? 'vencedor' : 'líder'}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatWhen(bid.createdAt)}</p>
                    </div>
                  </div>
                  <span className={cn('shrink-0 text-sm tabular-nums', leader && 'font-semibold')}>
                    {formatCents(bid.amountCents)}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function LotDetails({ lot }: { lot: PublicAuction }) {
  const [expanded, setExpanded] = useState(false);
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
    ['Lances', String(lot.bidCount)],
    ['Início', formatWhen(lot.startsAt)],
    ['Fim', formatWhen(lot.endsAt)],
  ];
  if (lot.originalEndsAt !== lot.endsAt) {
    facts.splice(facts.length - 1, 0, ['Fim original', formatWhen(lot.originalEndsAt)]);
  }
  const long = (lot.description?.length ?? 0) > 360;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Sobre o lote</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {lot.description ? (
          <div className="flex flex-col items-start gap-1">
            <p className={cn('text-sm leading-6', long && !expanded && 'line-clamp-5')}>{lot.description}</p>
            {long ? (
              <button
                type="button"
                className="text-sm font-medium underline underline-offset-4"
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? 'Mostrar menos' : 'Ler descrição completa'}
              </button>
            ) : null}
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 border-b border-border pb-2 sm:block sm:border-0 sm:pb-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words text-right text-sm sm:text-left">{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function RoomSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Entrando na sala">
      <div className="flex gap-4 sm:gap-6">
        <Skeleton className="aspect-[2/3] w-24 shrink-0 sm:w-32 lg:w-36" />
        <div className="flex flex-1 flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-72 lg:order-2" />
        <Skeleton className="h-72 lg:order-1" />
      </div>
      <p className="text-sm text-muted-foreground">Entrando na sala...</p>
    </div>
  );
}

function nextMinimum(lot: PublicAuction) {
  if (lot.currentBidCents === null) {
    return lot.startingBidCents;
  }
  const next = lot.currentBidCents + lot.minIncrementCents;
  return next > MONEY_MAX_CENTS ? null : next;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
