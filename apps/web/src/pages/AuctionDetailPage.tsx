import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { getAuction } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';

export function AuctionDetailPage() {
  const { auctionId } = useParams();
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

  return (
    <div className="flex flex-col gap-4">
      <Link className="text-sm font-medium text-muted-foreground underline" to="/">
        Voltar à vitrine
      </Link>
      <article className="grid gap-6 md:grid-cols-[220px_1fr]">
        <Cover auction={lot} className="aspect-[2/3] w-full rounded-lg md:max-w-[220px]" />
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{lot.title}</h1>
            <StatusBadge status={lot.displayStatus} />
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
    </div>
  );
}
