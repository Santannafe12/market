import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Clock, History, Radio, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { listAuctions, type PublicAuction, type ShowcaseStatus } from '@/lib/api';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

type Section = {
  status: ShowcaseStatus;
  title: string;
  description: string;
  empty: string;
  icon: LucideIcon;
};

const sections: Section[] = [
  {
    status: 'live',
    title: 'Ao vivo',
    description: 'Abertos para lances agora.',
    empty: 'Nenhum lote ao vivo neste momento.',
    icon: Radio,
  },
  {
    status: 'scheduled',
    title: 'Agendados',
    description: 'Ainda vão começar. Já dá para conhecer a peça.',
    empty: 'Nenhum lote agendado.',
    icon: CalendarClock,
  },
  {
    status: 'ended',
    title: 'Encerrados',
    description: 'O horário de fim já passou. Veja quem arrematou.',
    empty: 'Nenhum lote encerrado ainda.',
    icon: History,
  },
];

const filters: Array<{ value: ShowcaseStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'live', label: 'Ao vivo' },
  { value: 'scheduled', label: 'Agendados' },
  { value: 'ended', label: 'Encerrados' },
];

export function ShowcasePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const raw = params.get('status');
  const filter = sections.some((section) => section.status === raw) ? (raw as ShowcaseStatus) : 'all';
  const [term, setTerm] = useState(q);

  useEffect(() => {
    setTerm((current) => (current.trim() === q ? current : q));
  }, [q]);

  useEffect(() => {
    const next = term.trim();
    if (next === q) {
      return;
    }
    const timer = window.setTimeout(() => update({ q: next }), 300);
    return () => window.clearTimeout(timer);
  }, [term]);

  function update(patch: { q?: string; status?: ShowcaseStatus | 'all' }) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (patch.q !== undefined) {
          if (patch.q) next.set('q', patch.q);
          else next.delete('q');
        }
        if (patch.status !== undefined) {
          if (patch.status === 'all') next.delete('status');
          else next.set('status', patch.status);
        }
        return next;
      },
      { replace: true },
    );
  }

  const visible = filter === 'all' ? sections : sections.filter((section) => section.status === filter);

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Livros e edições raras</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">Vitrine</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Lotes separados pelo horário do servidor. Lotes cancelados não aparecem aqui.
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <form
            role="search"
            className="relative w-full lg:max-w-md"
            onSubmit={(event) => {
              event.preventDefault();
              update({ q: term.trim() });
            }}
          >
            <label htmlFor="showcase-search" className="sr-only">
              Buscar lotes pelo título
            </label>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="showcase-search"
              type="search"
              value={term}
              maxLength={100}
              placeholder="Buscar pelo título, ex.: Alienista"
              className="h-11 pl-9 pr-10 [&::-webkit-search-cancel-button]:hidden"
              onChange={(event) => setTerm(event.target.value)}
            />
            {term ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 size-8 -translate-y-1/2"
                aria-label="Limpar busca"
                onClick={() => {
                  setTerm('');
                  update({ q: '' });
                }}
              >
                <X />
              </Button>
            ) : null}
          </form>
          <div
            className="flex gap-1 rounded-lg border border-border bg-card p-1"
            role="group"
            aria-label="Filtrar por situação"
          >
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                onClick={() => update({ status: item.value })}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 lg:flex-none',
                  filter === item.value
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {q ? (
          <p className="text-sm text-muted-foreground" role="status">
            Mostrando lotes cujo título contém <span className="font-medium text-foreground">“{q}”</span>.
          </p>
        ) : null}
      </section>
      {visible.map((section) => (
        <AuctionSection key={section.status} section={section} q={q} />
      ))}
    </div>
  );
}

function AuctionSection({ section, q }: { section: Section; q: string }) {
  const query = useQuery({
    queryKey: ['auctions', section.status, q],
    queryFn: ({ signal }) => listAuctions(section.status, q, signal),
  });
  const Icon = section.icon;

  return (
    <section className="flex flex-col gap-4" aria-labelledby={`section-${section.status}`}>
      <div className="flex items-end justify-between gap-3 border-b border-border pb-3">
        <div>
          <h2 id={`section-${section.status}`} className="flex items-center gap-2 text-xl font-semibold">
            <Icon className={cn('size-5', section.status === 'live' ? 'text-live' : 'text-muted-foreground')} />
            {section.title}
            {query.data ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {query.data.length}
              </span>
            ) : null}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{section.description}</p>
        </div>
      </div>
      {query.isPending ? <CardGridSkeleton /> : null}
      {query.isError ? (
        <InlineError
          message={errorMessage(query.error, 'Não foi possível carregar os lotes.')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={q ? Search : Icon} title={q ? `Nenhum lote com “${q}” aqui.` : section.empty}>
          {q ? 'A busca olha só o título guardado no lote. Tente outra palavra ou limpe a busca.' : null}
        </EmptyState>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
          {query.data.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AuctionCard({ auction }: { auction: PublicAuction }) {
  const price = auction.currentBidCents ?? auction.startingBidCents;
  return (
    <Link
      to={`/lotes/${auction.id}`}
      className="group block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <article className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <div className="relative aspect-[3/4] overflow-hidden bg-muted">
          <Cover auction={auction} className="h-full w-full transition duration-300 group-hover:scale-[1.03]" />
          <StatusBadge status={auction.displayStatus} className="absolute left-2 top-2" />
        </div>
        <div className="flex flex-1 flex-col gap-1 p-3 sm:p-4">
          <h3 className="line-clamp-2 font-display text-sm font-semibold leading-snug sm:text-base">{auction.title}</h3>
          <p className="line-clamp-1 text-xs text-muted-foreground">
            {auction.authors.length > 0 ? auction.authors.join(', ') : 'Autor não informado'}
          </p>
          <div className="mt-auto pt-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{priceLabel(auction)}</p>
            <p className="text-base font-semibold tabular-nums sm:text-lg">
              {auction.status === 'UNSOLD' ? 'Sem vencedor' : formatCents(price)}
            </p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{whenLine(auction)}</span>
            </p>
          </div>
        </div>
      </article>
    </Link>
  );
}

function priceLabel(auction: PublicAuction) {
  if (auction.status === 'SETTLED') return 'Arrematado por';
  if (auction.status === 'UNSOLD') return 'Resultado';
  if (auction.currentBidCents === null) return 'Lance inicial';
  return `Lance atual · ${auction.bidCount} ${auction.bidCount === 1 ? 'lance' : 'lances'}`;
}

function whenLine(auction: PublicAuction) {
  if (auction.displayStatus === 'scheduled') return `Começa ${formatDayTime(auction.startsAt)}`;
  if (auction.displayStatus === 'live') return `Encerra ${formatDayTime(auction.endsAt)}`;
  if (auction.status === 'OPEN') return 'Aguardando liquidação';
  return `Encerrou ${formatDayTime(auction.endsAt)}`;
}

function formatDayTime(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4" aria-label="Carregando lotes">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border border-border bg-card">
          <Skeleton className="aspect-[3/4] rounded-none" />
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-3 h-5 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
