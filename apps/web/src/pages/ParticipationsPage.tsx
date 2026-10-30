import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import type { AppSession } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { participations, type Participation, type ParticipationResult, type PublicAuction } from '@/lib/api';
import { formatCents } from '@/lib/format';

const labels: Record<ParticipationResult, string> = {
  LEADING: 'Você está ganhando',
  OUTBID: 'Você foi superado',
  WON: 'Você arrematou',
  LOST: 'Outro licitante arrematou',
  CANCELLED: 'Lote cancelado',
};

export function ParticipationsPage() {
  const { user } = useOutletContext<AppSession>();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['participations'], queryFn: participations });

  if (user.role !== 'BIDDER') {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          O leiloeiro não dá lances. O resultado dos lotes publicados fica no painel.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meus arremates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lotes em que você deu lance, inclusive os que outra pessoa arrematou. A liquidação pode levar alguns segundos depois do fim.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: ['participations'] })}>
          Atualizar
        </Button>
      </div>
      {query.isPending ? <p className="text-sm text-muted-foreground">Carregando participações...</p> : null}
      {query.isError ? (
        <InlineError
          message={errorMessage(query.error, 'Não foi possível carregar suas participações.')}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data && query.data.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Você ainda não deu lances.
        </p>
      ) : null}
      <div className="grid gap-4">
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
          <p className="text-sm">{labels[item.result]}</p>
          <p className="text-sm text-muted-foreground">{amountLine(lot)}</p>
          {waiting && item.result === 'LEADING' ? (
            <p className="text-sm text-muted-foreground">Você lidera. Aguardando liquidação.</p>
          ) : null}
          {released ? (
            <p className="text-sm text-muted-foreground">
              O saldo comprometido deste lote foi liberado e voltou a ficar disponível. Nenhum valor foi creditado de novo.
            </p>
          ) : null}
          {item.receiptToken ? (
            <p className="text-sm">
              <Link className="font-medium underline" to={`/comprovantes/${item.receiptToken}`}>
                Abrir comprovante
              </Link>
              <span className="mt-1 block break-all text-muted-foreground">
                Link público, sem login: /comprovantes/{item.receiptToken}
              </span>
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function amountLine(lot: PublicAuction) {
  if (lot.currentBidCents === null) {
    return 'Sem lance registrado neste lote.';
  }
  return `Lance atual ${formatCents(lot.currentBidCents)}`;
}
