import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent } from '@/components/ui/card';
import { listAuctions, type PublicAuction } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';

const sections = [
  {
    status: 'live' as const,
    title: 'Ao vivo',
    description: 'Lotes abertos para acompanhamento agora.',
    empty: 'Nenhum lote ao vivo agora.',
  },
  {
    status: 'scheduled' as const,
    title: 'Agendados',
    description: 'Lotes que ainda vão começar.',
    empty: 'Nenhum lote agendado.',
  },
  {
    status: 'ended' as const,
    title: 'Encerrados',
    description: 'Lotes cujo horário de fim já passou.',
    empty: 'Nenhum lote encerrado.',
  },
];

export function ShowcasePage() {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vitrine</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Os lotes ficam separados pelo horário. Um lote cancelado não aparece aqui.
        </p>
      </div>
      {sections.map((section) => (
        <AuctionSection key={section.status} {...section} />
      ))}
    </div>
  );
}

function AuctionSection({
  status,
  title,
  description,
  empty,
}: (typeof sections)[number]) {
  const query = useQuery({
    queryKey: ['auctions', status],
    queryFn: () => listAuctions(status),
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {query.isPending ? <p className="text-sm text-muted-foreground">Carregando lotes...</p> : null}
      {query.isError ? (
        <InlineError
          message={errorMessage(query.error, 'Não foi possível carregar os lotes.')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : null}
      {query.data && query.data.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {query.data.map((auction) => (
            <AuctionCard key={auction.id} auction={auction} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function AuctionCard({ auction }: { auction: PublicAuction }) {
  const when =
    auction.displayStatus === 'scheduled'
      ? `Começa em ${formatWhen(auction.startsAt)}`
      : `Termina em ${formatWhen(auction.endsAt)}`;

  return (
    <Link to={`/lotes/${auction.id}`} className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full overflow-hidden">
        <Cover auction={auction} className="aspect-[3/2] w-full" />
        <CardContent className="flex flex-col gap-2 p-4">
          <div className="flex items-start justify-between gap-2">
            <h3 className="line-clamp-2 text-base font-semibold">{auction.title}</h3>
            <StatusBadge status={auction.displayStatus} />
          </div>
          <p className="text-sm text-muted-foreground">{authorsOf(auction.authors)}</p>
          <p className="text-sm">Lance inicial {formatCents(auction.startingBidCents)}</p>
          <p className="text-xs text-muted-foreground">{when}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function authorsOf(authors: string[]) {
  return authors.length > 0 ? authors.join(', ') : 'Autor não informado';
}
