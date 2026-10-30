import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FileCheck2, Gavel, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { EmptyState } from '@/components/EmptyState';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { participations, type Participation, type ParticipationResult, type PublicAuction } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';
import { cn } from '@/lib/utils';

const results: Record<ParticipationResult, { label: string; className: string }> = {
  LEADING: { label: 'Você está ganhando', className: 'bg-success/10 text-success ring-success/30' },
  OUTBID: { label: 'Você foi superado', className: 'bg-warning/10 text-warning ring-warning/30' },
  WON: { label: 'Você arrematou', className: 'bg-success/15 text-success ring-success/40' },
  LOST: { label: 'Outro licitante arrematou', className: 'bg-muted text-muted-foreground ring-border' },
  CANCELLED: { label: 'Lote cancelado', className: 'bg-destructive/5 text-destructive ring-destructive/30' },
};

export function ParticipationsPage() {
  const { user } = useOutletContext<AppSession>();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['participations'], queryFn: ({ signal }) => participations(signal) });

  if (user.role !== 'BIDDER') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground sm:p-6">
          O leiloeiro não dá lances. O resultado dos lotes publicados fica no painel.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Meus arremates</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Lotes em que você deu lance, inclusive os que outra pessoa arrematou. A liquidação pode levar alguns
            segundos depois do fim.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void queryClient.invalidateQueries({ queryKey: ['participations'] })}
        >
          <RotateCw className={cn(query.isFetching && 'animate-spin')} />
          Atualizar
        </Button>
      </div>
      {query.isPending ? <ListSkeleton /> : null}
      {query.isError ? (
        <InlineError
          message={errorMessage(query.error, 'Não foi possível carregar suas participações.')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.length === 0 ? (
        <EmptyState icon={Gavel} title="Você ainda não deu lances.">
          <Link className="font-medium text-foreground underline underline-offset-4" to="/">
            Ver os lotes ao vivo na vitrine
          </Link>
        </EmptyState>
      ) : null}
      <div className="grid gap-3">
        {query.data?.map((item) => (
          <ParticipationCard key={item.auction.id} item={item} publicId={user.publicId} />
        ))}
      </div>
    </div>
  );
}

function ParticipationCard({ item, publicId }: { item: Participation; publicId: string }) {
  const lot = item.auction;
  const waiting = lot.status === 'OPEN' && lot.displayStatus === 'ended';
  const released = item.result === 'CANCELLED' && lot.currentLeaderPublicId === publicId;
  const result = results[item.result];
  return (
    <Card className={cn(item.result === 'WON' && 'border-success/40')}>
      <CardContent className="flex gap-4 p-4 sm:p-5">
        <Link to={`/lotes/${lot.id}`} className="shrink-0">
          <Cover auction={lot} className="aspect-[2/3] w-16 rounded-md sm:w-20" />
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={lot.displayStatus} />
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1', result.className)}>
              {result.label}
            </span>
          </div>
          <Link className="font-display text-base font-semibold leading-snug hover:underline sm:text-lg" to={`/lotes/${lot.id}`}>
            {lot.title}
          </Link>
          <p className="text-sm text-muted-foreground">{amountLine(lot)}</p>
          {waiting && item.result === 'LEADING' ? (
            <p className="text-sm text-muted-foreground">Você lidera. Aguardando liquidação.</p>
          ) : null}
          {released ? (
            <p className="text-sm text-muted-foreground">
              O saldo comprometido deste lote foi liberado e voltou a ficar disponível. Nenhum valor foi creditado de novo.
            </p>
          ) : null}
          {item.receiptToken ? <ReceiptActions token={item.receiptToken} /> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ReceiptActions({ token }: { token: string }) {
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  const path = `/comprovantes/${token}`;
  const url = `${window.location.origin}${path}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('done');
    } catch {
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 2500);
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={path}>
            <FileCheck2 />
            Abrir comprovante
          </Link>
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
          {copied === 'done' ? <Check /> : <Copy />}
          {copied === 'done' ? 'Link copiado' : 'Copiar link'}
        </Button>
      </div>
      <p className="break-all text-xs text-muted-foreground" aria-live="polite">
        {copied === 'failed' ? 'Não foi possível copiar. Selecione o link: ' : 'Link público, sem login: '}
        {url}
      </p>
    </div>
  );
}

function amountLine(lot: PublicAuction) {
  if (lot.currentBidCents === null) {
    return 'Sem lance registrado neste lote.';
  }
  const label = lot.status === 'SETTLED' ? 'Arrematado por' : 'Lance atual';
  return `${label} ${formatCents(lot.currentBidCents)} · fim ${formatWhen(lot.endsAt)}`;
}

function ListSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Carregando participações">
      {[0, 1].map((index) => (
        <div key={index} className="flex gap-4 rounded-xl border border-border bg-card p-5">
          <Skeleton className="aspect-[2/3] w-16 sm:w-20" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
