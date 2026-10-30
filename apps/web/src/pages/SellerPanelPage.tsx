import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CalendarClock, Coins, Library, PackageOpen, Radio, RotateCw, Search } from 'lucide-react';
import { FormEvent, useState, type ReactNode } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  cancelAuction,
  createAuction,
  editionPreview,
  myAuctions,
  searchWorks,
  sellerReceived,
  workEditions,
  type PublicAuction,
} from '@/lib/api';
import { formatCents, formatWhen, parseReais } from '@/lib/format';
import { cn } from '@/lib/utils';

export function SellerPanelPage() {
  const { user } = useOutletContext<AppSession>();
  if (user.role !== 'SELLER') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Painel do leiloeiro</CardTitle>
          <CardDescription>Somente leiloeiros publicam e cancelam lotes.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link to="/">Voltar à vitrine</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Painel do leiloeiro</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Busque uma obra, escolha a edição e publique o lote. O título e a ficha vêm da Open Library e ficam
            guardados no lote.
          </p>
        </div>
        <SellerStats />
      </div>
      <CreateLot />
      <MyLots />
    </div>
  );
}

function SellerStats() {
  const lots = useQuery({ queryKey: ['auctions', 'mine'], queryFn: ({ signal }) => myAuctions(signal) });
  const received = useQuery({
    queryKey: ['auctions', 'received'],
    queryFn: ({ signal }) => sellerReceived(signal),
  });
  const open = lots.data?.filter((lot) => lot.status === 'OPEN' && lot.displayStatus !== 'ended').length;
  const sold = lots.data?.filter((lot) => lot.status === 'SETTLED').length;
  return (
    <Card className="grid grid-cols-3 divide-x divide-border">
      <Stat
        icon={Coins}
        label="Total recebido"
        value={received.data ? formatCents(received.data.receivedCents) : undefined}
        hint="Créditos de liquidação, sem depósitos"
        failed={received.isError}
      />
      <Stat icon={Radio} label="Abertos" value={open?.toString()} hint="Ao vivo ou agendados" failed={lots.isError} />
      <Stat icon={Library} label="Arrematados" value={sold?.toString()} hint="Liquidados com vencedor" failed={lots.isError} />
    </Card>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  failed,
}: {
  icon: typeof Coins;
  label: string;
  value: string | undefined;
  hint: string;
  failed: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 p-3 sm:p-5">
      <p className="flex items-center gap-2 text-xs text-muted-foreground sm:text-sm">
        <Icon className="hidden size-4 sm:block" aria-hidden="true" />
        {label}
      </p>
      {value !== undefined ? (
        <p className="truncate text-lg font-semibold tabular-nums sm:text-2xl">{value}</p>
      ) : failed ? (
        <p className="text-lg font-semibold text-muted-foreground sm:text-2xl">—</p>
      ) : (
        <Skeleton className="my-1 h-7 w-16 sm:w-24" />
      )}
      <p className="hidden text-xs text-muted-foreground sm:block">{hint}</p>
    </div>
  );
}

function Step({ number, title, description, children, className }: {
  number: number;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
            {number}
          </span>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}

function CreateLot() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [workId, setWorkId] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [startingBid, setStartingBid] = useState('10,00');
  const [increment, setIncrement] = useState('1,00');
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(new Date(Date.now() - 60_000)));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60_000)));
  const [searchError, setSearchError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState<PublicAuction | null>(null);

  const works = useQuery({
    queryKey: ['catalog', 'search', submitted],
    queryFn: () => searchWorks(submitted),
    enabled: submitted.length >= 2,
    retry: false,
  });
  const editions = useQuery({
    queryKey: ['catalog', 'editions', workId],
    queryFn: () => workEditions(workId ?? ''),
    enabled: Boolean(workId),
    retry: false,
  });
  const edition = useQuery({
    queryKey: ['catalog', 'edition', editionId],
    queryFn: () => editionPreview(editionId ?? ''),
    enabled: Boolean(editionId),
    retry: false,
  });
  const create = useMutation({
    mutationFn: createAuction,
    onSuccess: async (lot) => {
      setSuccess(lot);
      setFormError('');
      setEditionId(null);
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      await queryClient.invalidateQueries({ queryKey: ['auction'] });
    },
    onError: (error) => {
      setSuccess(null);
      setFormError(errorMessage(error, 'Não foi possível criar o lote.'));
    },
  });

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const next = term.trim();
    if (next.length < 2) {
      setSearchError('A busca precisa ter pelo menos 2 caracteres.');
      return;
    }
    setSearchError('');
    setFormError('');
    setSuccess(null);
    setWorkId(null);
    setEditionId(null);
    setSubmitted(next);
  }

  function publish(event: FormEvent) {
    event.preventDefault();
    setSuccess(null);
    if (!edition.data) {
      setFormError('Escolha uma edição antes de publicar.');
      return;
    }
    const startingBidCents = parseReais(startingBid);
    const minIncrementCents = parseReais(increment);
    if (startingBidCents === null || minIncrementCents === null) {
      setFormError('Informe lance inicial e incremento em reais, por exemplo 10,00.');
      return;
    }
    const start = fromDateTimeLocal(startsAt);
    const end = fromDateTimeLocal(endsAt);
    if (!start || !end) {
      setFormError('Informe início e fim válidos.');
      return;
    }
    if (new Date(end).getTime() <= new Date(start).getTime()) {
      setFormError('O fim precisa ser posterior ao início.');
      return;
    }
    if (new Date(end).getTime() <= Date.now()) {
      setFormError('O fim precisa ser posterior ao horário atual.');
      return;
    }
    setFormError('');
    create.mutate({
      editionId: edition.data.editionId,
      startingBidCents,
      minIncrementCents,
      startsAt: start,
      endsAt: end,
    });
  }

  const startingPreview = parseReais(startingBid);
  const incrementPreview = parseReais(increment);

  return (
    <section className="grid gap-4 lg:grid-cols-2" aria-label="Publicar lote">
      <Step number={1} title="Buscar obra" description="A pesquisa consulta a Open Library e mostra até 10 obras.">
        <form className="flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={onSearch}>
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="search">Título, autor ou ISBN</Label>
            <Input
              id="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Ex.: Fantastic Mr Fox"
            />
          </div>
          <Button type="submit" disabled={works.isFetching}>
            <Search />
            {works.isFetching ? 'Buscando...' : 'Buscar'}
          </Button>
        </form>
        {searchError ? <p className="text-sm text-destructive">{searchError}</p> : null}
        {works.isError ? (
          <InlineError
            message={errorMessage(works.error, 'Não foi possível buscar agora.')}
            onRetry={() => void works.refetch()}
          />
        ) : null}
        {works.isFetching && !works.data ? <OptionSkeleton /> : null}
        {works.data && works.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma obra encontrada. Tente o título original ou o autor.</p>
        ) : null}
        <div className="flex flex-col gap-2">
          {works.data?.map((work) => (
            <OptionButton
              key={work.workId}
              selected={workId === work.workId}
              title={work.title}
              detail={[work.authors.join(', '), work.firstPublishYear].filter(Boolean).join(' · ') || 'Sem dados extras'}
              onClick={() => {
                setWorkId(work.workId);
                setEditionId(null);
                setSuccess(null);
              }}
            />
          ))}
        </div>
      </Step>

      <Step number={2} title="Escolher edição" description="Até 20 edições. Data, ISBN e capa podem faltar.">
        {!workId ? <p className="text-sm text-muted-foreground">Escolha uma obra para ver as edições.</p> : null}
        {editions.isPending && workId ? <OptionSkeleton /> : null}
        {editions.isError ? (
          <InlineError
            message={errorMessage(editions.error, 'Não foi possível carregar as edições.')}
            onRetry={() => void editions.refetch()}
          />
        ) : null}
        {editions.data && editions.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma edição encontrada para esta obra.</p>
        ) : null}
        <div className="flex max-h-80 flex-col gap-2 overflow-auto pr-1">
          {editions.data?.map((item) => (
            <OptionButton
              key={item.editionId}
              selected={editionId === item.editionId}
              title={item.title}
              detail={[item.publishedYear, item.publisher, item.isbn].filter(Boolean).join(' · ') || 'Dados incompletos'}
              onClick={() => {
                setEditionId(item.editionId);
                setSuccess(null);
              }}
            />
          ))}
        </div>
      </Step>

      <Step
        number={3}
        title="Publicar lote"
        description="Se o início for agora ou no passado, o lote entra ao vivo. O fim precisa ser depois do início e do horário atual."
        className="lg:col-span-2"
      >
        {success ? (
          <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success" role="status">
            Lote publicado: <span className="font-medium">{success.title}</span>.{' '}
            <Link className="font-medium underline underline-offset-4" to={`/lotes/${success.id}`}>
              Abrir a sala
            </Link>
          </p>
        ) : null}
        {edition.isError ? (
          <InlineError
            message={errorMessage(edition.error, 'Não foi possível ler essa edição.')}
            onRetry={() => void edition.refetch()}
          />
        ) : null}
        {edition.data ? (
          <form className="flex flex-col gap-5" onSubmit={publish} noValidate>
            <div className="flex gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
              <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium">{edition.data.title}</p>
                <p className="text-muted-foreground">{edition.data.authors.join(', ') || 'Autor não informado'}</p>
                {edition.data.description ? <p className="mt-2 line-clamp-3">{edition.data.description}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartsAt(toDateTimeLocal(new Date(Date.now() - 60_000)));
                  setEndsAt(toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60_000)));
                }}
              >
                <Radio />
                Começar agora
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const start = new Date(Date.now() + 60 * 60_000);
                  setStartsAt(toDateTimeLocal(start));
                  setEndsAt(toDateTimeLocal(new Date(start.getTime() + 24 * 60 * 60_000)));
                }}
              >
                <CalendarClock />
                Agendar para daqui a 1 hora
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField
                id="startingBid"
                label="Lance inicial"
                value={startingBid}
                onChange={setStartingBid}
                preview={startingPreview}
              />
              <MoneyField
                id="increment"
                label="Incremento mínimo"
                value={increment}
                onChange={setIncrement}
                preview={incrementPreview}
              />
              <div className="flex flex-col gap-2">
                <Label htmlFor="startsAt">Início</Label>
                <Input
                  id="startsAt"
                  type="datetime-local"
                  required
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="endsAt">Fim</Label>
                <Input
                  id="endsAt"
                  type="datetime-local"
                  required
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
                />
              </div>
            </div>
            {formError ? (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            ) : null}
            <Button className="self-start" type="submit" disabled={create.isPending}>
              {create.isPending ? 'Publicando...' : 'Publicar lote'}
            </Button>
          </form>
        ) : edition.isPending && editionId ? (
          <OptionSkeleton />
        ) : edition.isError ? null : (
          <p className="text-sm text-muted-foreground">Selecione uma edição para definir o leilão.</p>
        )}
      </Step>
    </section>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  preview,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  preview: number | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          R$
        </span>
        <Input
          id={id}
          inputMode="decimal"
          required
          className="pl-10 tabular-nums"
          value={value}
          aria-invalid={preview === null ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <p className={cn('text-xs', preview === null ? 'text-destructive' : 'text-muted-foreground')}>
        {preview === null ? 'Valor inválido. Use o formato 10,00.' : formatCents(preview)}
      </p>
    </div>
  );
}

function OptionButton({
  selected,
  title,
  detail,
  onClick,
}: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : 'border-border bg-card hover:bg-muted',
      )}
      onClick={onClick}
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{detail}</span>
    </button>
  );
}

function OptionSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-label="Carregando">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-4/5" />
    </div>
  );
}

function MyLots() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lots = useQuery({ queryKey: ['auctions', 'mine'], queryFn: ({ signal }) => myAuctions(signal) });
  const cancel = useMutation({
    mutationFn: cancelAuction,
    onSuccess: async (lot) => {
      setConfirming(null);
      setError('');
      setMessage(`${lot.title} foi cancelado. Se havia um líder, o saldo comprometido voltou a ficar disponível.`);
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      await queryClient.invalidateQueries({ queryKey: ['auction'] });
    },
    onError: (caught) => {
      setMessage('');
      setError(errorMessage(caught, 'Não foi possível cancelar o lote.'));
    },
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="my-lots">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
        <h2 id="my-lots" className="text-xl font-semibold">
          Meus lotes
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={lots.isFetching}
          onClick={() => {
            void queryClient.invalidateQueries({ queryKey: ['auctions', 'mine'] });
            void queryClient.invalidateQueries({ queryKey: ['auctions', 'received'] });
          }}
        >
          <RotateCw className={cn(lots.isFetching && 'animate-spin')} />
          Atualizar
        </Button>
      </div>
      {lots.isPending ? (
        <div className="grid gap-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : null}
      {lots.isError ? (
        <InlineError
          message={errorMessage(lots.error, 'Não foi possível carregar seus lotes.')}
          onRetry={() => void lots.refetch()}
        />
      ) : null}
      {message ? (
        <p className="rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-sm text-success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {lots.data && lots.data.length === 0 ? (
        <EmptyState icon={PackageOpen} title="Você ainda não publicou lotes.">
          Use os três passos acima para publicar o primeiro.
        </EmptyState>
      ) : null}
      <div className="grid gap-3">
        {lots.data?.map((lot) => (
          <OwnedLot
            key={lot.id}
            lot={lot}
            confirming={confirming === lot.id}
            pending={cancel.isPending && confirming === lot.id}
            onAsk={() => {
              setConfirming(lot.id);
              setError('');
            }}
            onBack={() => setConfirming(null)}
            onConfirm={() => cancel.mutate(lot.id)}
          />
        ))}
      </div>
    </section>
  );
}

function OwnedLot({
  lot,
  confirming,
  pending,
  onAsk,
  onBack,
  onConfirm,
}: {
  lot: PublicAuction;
  confirming: boolean;
  pending: boolean;
  onAsk: () => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const canCancel = lot.status === 'OPEN';
  const waiting = lot.status === 'OPEN' && lot.displayStatus === 'ended';
  return (
    <Card>
      <CardContent className="flex gap-4 p-4 sm:p-5">
        <Link to={`/lotes/${lot.id}`} className="shrink-0">
          <Cover auction={lot} className="aspect-[2/3] w-16 rounded-md sm:w-20" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lot.displayStatus} />
            <span className="text-xs text-muted-foreground">
              {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'} · fim {formatWhen(lot.endsAt)}
            </span>
          </div>
          <Link className="font-display text-base font-semibold leading-snug hover:underline sm:text-lg" to={`/lotes/${lot.id}`}>
            {lot.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            Lance inicial {formatCents(lot.startingBidCents)}
            {lot.status === 'OPEN' && lot.currentBidCents !== null ? ` · lance atual ${formatCents(lot.currentBidCents)}` : null}
          </p>
          {lot.status === 'SETTLED' && lot.currentBidCents !== null ? (
            <p className="text-sm font-medium text-success">Arrematado por {formatCents(lot.currentBidCents)}.</p>
          ) : null}
          {lot.status === 'UNSOLD' ? <p className="text-sm">Encerrado sem vencedor.</p> : null}
          {waiting ? (
            <p className="text-sm text-muted-foreground">Encerrado, aguardando liquidação. Isso pode levar alguns segundos.</p>
          ) : null}
          {canCancel && !confirming ? (
            <Button className="self-start" type="button" variant="outline" size="sm" onClick={onAsk}>
              Cancelar lote
            </Button>
          ) : null}
          {canCancel && confirming ? (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm">
                {lot.bidCount > 0
                  ? 'O saldo comprometido do líder será liberado e voltará a ficar disponível. Nenhum valor será creditado de novo na carteira.'
                  : 'Este lote ainda não tem lances. O cancelamento apenas o encerra.'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
                  {pending ? 'Cancelando...' : 'Confirmar cancelamento'}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={pending}>
                  Voltar
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function toDateTimeLocal(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDateTimeLocal(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
