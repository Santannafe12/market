import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import {
  ROOM_REFRESH_MS,
  RoomSync,
  bidStanding,
  refreshRoom,
  type RoomState,
} from '@realtime/auction-sync';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { formatCents, formatRemaining, formatWhen, parseCents } from '@/lib/format';
import {
  disconnectRealtime,
  ensureRealtime,
  joinAuctionRoom,
  onAuctionUpdated,
  onRealtimeConnect,
  onRealtimeDisconnect,
  onWalletHint,
} from '@/lib/realtime';

type Viewer = PublicUser | null;

export function AuctionDetailPage() {
  const { auctionId } = useParams();
  const { user } = useOutletContext<AppSession | { user: Viewer }>();
  const queryClient = useQueryClient();
  const syncRef = useRef(new RoomSync<PublicAuction>());
  const [room, setRoom] = useState<RoomState<PublicAuction> | null>(null);
  const [link, setLink] = useState<'connecting' | 'online' | 'reconnecting' | 'offline'>('connecting');
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
          setLoadError(error instanceof ApiError ? error.message : 'Não foi possível abrir este lote.');
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
    return <p className="text-sm text-muted-foreground">Lote não informado.</p>;
  }

  if (!room && loadError) {
    return (
      <div className="flex flex-col items-start gap-3">
        <InlineError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
        {user ? (
          <Link className="text-sm font-medium underline" to="/">
            Voltar à vitrine
          </Link>
        ) : null}
      </div>
    );
  }

  if (!room) {
    return <p className="text-sm text-muted-foreground">Entrando na sala...</p>;
  }

  const lot = room.auction;

  return (
    <div className="flex flex-col gap-6">
      {user ? (
        <Link className="text-sm font-medium text-muted-foreground underline" to="/">
          Voltar à vitrine
        </Link>
      ) : null}
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
          <LotFacts lot={lot} />
        </div>
      </article>
      <LiveBoard bids={room.bids} link={link} lot={lot} serverNow={room.serverNow} user={user} />
      <RoomActions
        auctionId={auctionId}
        bids={room.bids}
        lot={lot}
        serverNow={room.serverNow}
        syncRef={syncRef}
        user={user}
        onRoom={setRoom}
      />
    </div>
  );
}

function LotFacts({ lot }: { lot: PublicAuction }) {
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
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function LiveBoard({
  lot,
  bids,
  serverNow,
  link,
  user,
}: {
  lot: PublicAuction;
  bids: PublicBid[];
  serverNow: string;
  link: 'connecting' | 'online' | 'reconnecting' | 'offline';
  user: Viewer;
}) {
  const standing = bidStanding(user ? { publicId: user.publicId, role: user.role } : null, lot, bids);
  const extended = lot.originalEndsAt !== lot.endsAt;
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">Lance atual</p>
          <p className="text-3xl font-semibold tracking-tight">
            {lot.currentBidCents === null ? 'Ainda sem lances' : formatCents(lot.currentBidCents)}
          </p>
        </div>
        <Countdown lot={lot} serverNow={serverNow} />
      </div>
      <StandingLine standing={standing} />
      {extended ? (
        <p className="text-sm">
          Horário prorrogado. Novo fim: {formatWhen(lot.endsAt)}. Fim original: {formatWhen(lot.originalEndsAt)}.
        </p>
      ) : null}
      <LotOutcome lot={lot} user={user} />
      <p className="text-xs text-muted-foreground">{linkLabel[link]}</p>
    </section>
  );
}

const linkLabel = {
  connecting: 'Conectando à sala...',
  online: 'Sala conectada.',
  reconnecting: 'Reconectando a sala...',
  offline: 'Sem conexão com a sala. Os dados continuam vindo do servidor.',
};

function StandingLine({ standing }: { standing: ReturnType<typeof bidStanding> }) {
  const text =
    standing === 'leading'
      ? 'Você está ganhando.'
      : standing === 'outbid'
        ? 'Você foi superado.'
        : standing === 'watching'
          ? 'Você ainda não deu lances.'
          : standing === 'visitor'
            ? 'Você está acompanhando como visitante.'
            : 'O leiloeiro não pode dar lances.';
  return (
    <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm" role="status">
      {text}
    </p>
  );
}

function LotOutcome({ lot, user }: { lot: PublicAuction; user: Viewer }) {
  if (lot.status === 'SETTLED') {
    return (
      <p className="text-sm">
        {user && lot.currentLeaderPublicId === user.publicId
          ? 'Você arrematou este lote.'
          : 'Este lote foi arrematado.'}
      </p>
    );
  }
  if (lot.status === 'UNSOLD') {
    return <p className="text-sm">Este lote encerrou sem lances.</p>;
  }
  if (lot.status === 'CANCELLED') {
    return <p className="text-sm">Este lote foi cancelado.</p>;
  }
  if (lot.status === 'OPEN' && lot.displayStatus === 'ended') {
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
    return null;
  }
  const estimated = Date.now() + (offsetRef.current?.offset ?? 0);
  const start = Date.parse(lot.startsAt);
  const end = Date.parse(lot.endsAt);
  if (estimated < start) {
    return (
      <p className="text-sm">
        Começa em <span className="font-medium tabular-nums">{formatRemaining(start - estimated)}</span>
      </p>
    );
  }
  if (estimated < end) {
    return (
      <p className="text-sm">
        Encerra em <span className="font-medium tabular-nums">{formatRemaining(end - estimated)}</span>
      </p>
    );
  }
  return <p className="text-sm text-muted-foreground">00:00</p>;
}

function RoomActions({
  auctionId,
  lot,
  bids,
  user,
  serverNow,
  syncRef,
  onRoom,
}: {
  auctionId: string;
  lot: PublicAuction;
  bids: PublicBid[];
  user: Viewer;
  serverNow: string;
  syncRef: { current: RoomSync<PublicAuction> };
  onRoom: (room: RoomState<PublicAuction> | null) => void;
}) {
  const history = <BidHistory bids={bids} />;
  if (user?.role !== 'BIDDER') {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          {user ? null : (
            <Button asChild className="self-start">
              <Link to="/entrar" state={{ from: `/lotes/${auctionId}` }}>
                Entrar para dar um lance
              </Link>
            </Button>
          )}
          {history}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <BidPanel
        auctionId={auctionId}
        bids={bids}
        history={history}
        lot={lot}
        serverNow={serverNow}
        syncRef={syncRef}
        onRoom={onRoom}
      />
      <WalletCard />
    </div>
  );
}

function BidPanel({
  auctionId,
  lot,
  bids,
  serverNow,
  syncRef,
  onRoom,
  history,
}: {
  auctionId: string;
  lot: PublicAuction;
  bids: PublicBid[];
  serverNow: string;
  syncRef: { current: RoomSync<PublicAuction> };
  onRoom: (room: RoomState<PublicAuction> | null) => void;
  history: ReactNode;
}) {
  const queryClient = useQueryClient();
  const minimum = nextMinimum(lot);
  const [amount, setAmount] = useState(minimum === null ? '' : String(minimum));
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [pending, setPending] = useState(false);
  const open = lot.status === 'OPEN' && lot.displayStatus !== 'ended';

  useEffect(() => {
    if (minimum === null) {
      return;
    }
    setAmount((current) => {
      const parsed = parseCents(current);
      if (parsed === null || parsed < minimum) {
        return String(minimum);
      }
      return current;
    });
  }, [minimum]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSuccess('');
    const cents = parseCents(amount);
    if (cents === null) {
      setFormError('Informe um valor inteiro em centavos, de 1 até 2000000000.');
      return;
    }
    setFormError('');
    setPending(true);
    let accepted = false;
    try {
      const result = await placeBid(auctionId, cents);
      accepted = true;
      const previousEndsAt = lot.endsAt;
      queryClient.setQueryData(['wallet'], result.wallet);
      setSuccess(result.auction.endsAt !== previousEndsAt ? 'Lance aceito. O fim do lote avançou 2 minutos.' : 'Lance aceito.');
      const next = nextMinimum(result.auction);
      setAmount(next === null ? '' : String(next));
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
        setFormError(caught instanceof ApiError ? caught.message : 'Não foi possível registrar o lance.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
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
        {open ? (
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
            <Button type="submit" disabled={pending || minimum === null}>
              {pending ? 'Enviando...' : 'Enviar lance'}
            </Button>
          </form>
        ) : (
          <p className="text-sm text-muted-foreground">Este lote não aceita mais lances.</p>
        )}
        {history}
      </CardContent>
    </Card>
  );
}

function WalletCard() {
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: ({ signal }) => getWallet(signal) });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sua carteira</CardTitle>
        <CardDescription>
          <Link className="underline" to="/carteira">
            Depositar
          </Link>
          {' · '}
          <Link className="underline" to="/arremates">
            Meus arremates
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
  );
}

function BidHistory({ bids }: { bids: PublicBid[] }) {
  if (bids.length === 0) {
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

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}
