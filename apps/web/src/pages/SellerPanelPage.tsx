import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  cancelAuction,
  createAuction,
  editionPreview,
  myAuctions,
  searchWorks,
  workEditions,
  type PublicAuction,
} from '@/lib/api';
import { formatCents, formatWhen, parseCents } from '@/lib/format';
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Painel do leiloeiro</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Busque uma obra, escolha a edição e publique o lote. O título vem da Open Library.
        </p>
      </div>
      <CreateLot />
      <MyLots />
    </div>
  );
}

function CreateLot() {
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [workId, setWorkId] = useState<string | null>(null);
  const [editionId, setEditionId] = useState<string | null>(null);
  const [startingBid, setStartingBid] = useState('1000');
  const [increment, setIncrement] = useState('100');
  const [startsAt, setStartsAt] = useState(() => toDateTimeLocal(new Date(Date.now() - 60_000)));
  const [endsAt, setEndsAt] = useState(() => toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60_000)));
  const [searchError, setSearchError] = useState('');
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');

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
      setSuccess(`Lote publicado: ${lot.title}.`);
      setFormError('');
      setEditionId(null);
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      await queryClient.invalidateQueries({ queryKey: ['auction'] });
    },
    onError: (error) => {
      setSuccess('');
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
    setSuccess('');
    setWorkId(null);
    setEditionId(null);
    setSubmitted(next);
  }

  function publish(event: FormEvent) {
    event.preventDefault();
    setSuccess('');
    if (!edition.data) {
      setFormError('Escolha uma edição antes de publicar.');
      return;
    }
    const startingBidCents = parseCents(startingBid);
    const minIncrementCents = parseCents(increment);
    if (startingBidCents === null || minIncrementCents === null) {
      setFormError('Informe lance inicial e incremento em centavos, de 1 até 2000000000.');
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

  const startingPreview = parseCents(startingBid);
  const incrementPreview = parseCents(increment);

  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Buscar obra</CardTitle>
          <CardDescription>A pesquisa consulta a Open Library e mostra até 10 obras.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSearch}>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="search">Título, autor ou ISBN</Label>
              <Input
                id="search"
                value={term}
                onChange={(event) => setTerm(event.target.value)}
                placeholder="Ex.: Fantastic Mr Fox"
              />
            </div>
            <Button className="sm:self-end" type="submit" disabled={works.isFetching}>
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
          {works.data && works.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma obra encontrada.</p>
          ) : null}
          <div className="flex flex-col gap-2">
            {works.data?.map((work) => (
              <button
                key={work.workId}
                type="button"
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm',
                  workId === work.workId ? 'border-primary bg-muted' : 'border-border bg-card',
                )}
                onClick={() => {
                  setWorkId(work.workId);
                  setEditionId(null);
                  setSuccess('');
                }}
              >
                <span className="block font-medium">{work.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {[work.authors.join(', '), work.firstPublishYear].filter(Boolean).join(' · ') ||
                    'Sem dados extras'}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Escolher edição</CardTitle>
          <CardDescription>Mostramos no máximo 20 edições. Data, ISBN e capa podem faltar.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!workId ? <p className="text-sm text-muted-foreground">Escolha uma obra para ver as edições.</p> : null}
          {editions.isPending && workId ? (
            <p className="text-sm text-muted-foreground">Carregando edições...</p>
          ) : null}
          {editions.isError ? (
            <InlineError
              message={errorMessage(editions.error, 'Não foi possível carregar as edições.')}
              onRetry={() => void editions.refetch()}
            />
          ) : null}
          {editions.data && editions.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma edição encontrada para esta obra.</p>
          ) : null}
          <div className="flex max-h-80 flex-col gap-2 overflow-auto">
            {editions.data?.map((item) => (
              <button
                key={item.editionId}
                type="button"
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm',
                  editionId === item.editionId ? 'border-primary bg-muted' : 'border-border bg-card',
                )}
                onClick={() => {
                  setEditionId(item.editionId);
                  setSuccess('');
                }}
              >
                <span className="block font-medium">{item.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {[item.publishedYear, item.publisher, item.isbn].filter(Boolean).join(' · ') ||
                    'Dados incompletos'}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg">Publicar lote</CardTitle>
          <CardDescription>
            Se o início for agora ou no passado, o lote entra ao vivo. O fim precisa ser depois do início e do horário atual.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {success ? <p className="text-sm">{success}</p> : null}
          {edition.isError ? (
            <InlineError
              message={errorMessage(edition.error, 'Não foi possível ler essa edição.')}
              onRetry={() => void edition.refetch()}
            />
          ) : null}
          {edition.data ? (
            <form className="flex flex-col gap-4" onSubmit={publish}>
              <div className="rounded-md bg-muted px-3 py-3 text-sm">
                <p className="font-medium">{edition.data.title}</p>
                <p className="text-muted-foreground">
                  {edition.data.authors.join(', ') || 'Autor não informado'}
                </p>
                {edition.data.description ? <p className="mt-2 line-clamp-3">{edition.data.description}</p> : null}
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
                  Agendar para daqui a 1 hora
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="startingBid">Lance inicial (centavos)</Label>
                  <Input
                    id="startingBid"
                    inputMode="numeric"
                    min={1}
                    required
                    value={startingBid}
                    onChange={(event) => setStartingBid(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {startingPreview === null ? 'Valor inválido.' : formatCents(startingPreview)}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="increment">Incremento mínimo (centavos)</Label>
                  <Input
                    id="increment"
                    inputMode="numeric"
                    min={1}
                    required
                    value={increment}
                    onChange={(event) => setIncrement(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {incrementPreview === null ? 'Valor inválido.' : formatCents(incrementPreview)}
                  </p>
                </div>
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
              {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
              <Button className="self-start" type="submit" disabled={create.isPending}>
                {create.isPending ? 'Publicando...' : 'Publicar lote'}
              </Button>
            </form>
          ) : edition.isPending && editionId ? (
            <p className="text-sm text-muted-foreground">Carregando edição...</p>
          ) : edition.isError ? null : (
            <p className="text-sm text-muted-foreground">Selecione uma edição para definir o leilão.</p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function MyLots() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lots = useQuery({ queryKey: ['auctions', 'mine'], queryFn: myAuctions });
  const cancel = useMutation({
    mutationFn: cancelAuction,
    onSuccess: async (lot) => {
      setConfirming(null);
      setError('');
      setMessage(`${lot.title} foi cancelado.`);
      await queryClient.invalidateQueries({ queryKey: ['auctions'] });
      await queryClient.invalidateQueries({ queryKey: ['auction'] });
    },
    onError: (caught) => {
      setMessage('');
      setError(errorMessage(caught, 'Não foi possível cancelar o lote.'));
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Meus lotes</h2>
      {lots.isPending ? <p className="text-sm text-muted-foreground">Carregando seus lotes...</p> : null}
      {lots.isError ? (
        <InlineError
          message={errorMessage(lots.error, 'Não foi possível carregar seus lotes.')}
          onRetry={() => void lots.refetch()}
        />
      ) : null}
      {message ? <p className="text-sm">{message}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {lots.data && lots.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">Você ainda não publicou lotes.</p>
      ) : null}
      <div className="grid gap-4">
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
  const canCancel = lot.status === 'OPEN' && lot.bidCount === 0;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
        <Cover auction={lot} className="h-24 w-16 shrink-0 rounded-md" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link className="font-medium underline" to={`/lotes/${lot.id}`}>
              {lot.title}
            </Link>
            <StatusBadge status={lot.displayStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {formatCents(lot.startingBidCents)} · {lot.bidCount} {lot.bidCount === 1 ? 'lance' : 'lances'} · fim{' '}
            {formatWhen(lot.endsAt)}
          </p>
          {canCancel && !confirming ? (
            <Button className="self-start" type="button" variant="outline" size="sm" onClick={onAsk}>
              Cancelar lote
            </Button>
          ) : null}
          {canCancel && confirming ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" size="sm" onClick={onConfirm} disabled={pending}>
                {pending ? 'Cancelando...' : 'Confirmar cancelamento'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={pending}>
                Voltar
              </Button>
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
