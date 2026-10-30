import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { PublicLayout } from '@/components/AppLayout';
import { Cover } from '@/components/Cover';
import { InlineError, errorMessage } from '@/components/InlineError';
import { StatusBadge } from '@/components/StatusBadge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAudit, type AuditVerdict } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';
import { cn } from '@/lib/utils';

const verdictCopy: Record<AuditVerdict, { title: string; text: string; className: string; icon: LucideIcon }> = {
  INTEGRO: {
    title: 'Íntegro',
    text: 'O histórico confere. As assinaturas, a sequência e o estado do lote estão de acordo.',
    className: 'border-success/50 bg-success/10 text-success',
    icon: ShieldCheck,
  },
  ADULTERADO: {
    title: 'Adulterado',
    text: 'O histórico não confere. Alguma informação foi alterada depois de registrada.',
    className: 'border-destructive/50 bg-destructive/10 text-destructive',
    icon: ShieldAlert,
  },
  INDETERMINADO: {
    title: 'Indeterminado',
    text: 'Não foi possível concluir a verificação. Isso não significa que o histórico esteja íntegro.',
    className: 'border-border bg-muted text-foreground',
    icon: ShieldQuestion,
  },
};

export function AuditPage() {
  const { auctionId } = useParams();
  const report = useQuery({
    queryKey: ['audit', auctionId],
    queryFn: () => getAudit(auctionId ?? ''),
    enabled: Boolean(auctionId),
  });

  return (
    <PublicLayout>
      {!auctionId || report.isPending ? <AuditSkeleton /> : null}
      {report.isError ? (
        <InlineError
          message={errorMessage(report.error, 'Não foi possível abrir a auditoria deste lote.')}
          onRetry={() => void report.refetch()}
        />
      ) : null}
      {report.data ? <ReportBody auctionId={auctionId ?? ''} report={report.data} /> : null}
    </PublicLayout>
  );
}

function ReportBody({
  auctionId,
  report,
}: {
  auctionId: string;
  report: Awaited<ReturnType<typeof getAudit>>;
}) {
  const verdict = verdictCopy[report.verdict];
  const Icon = verdict.icon;
  const lot = report.auction;
  return (
    <>
      <div className="flex gap-4">
        <Cover auction={lot} className="aspect-[2/3] w-16 shrink-0 rounded-md shadow sm:w-20" />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Auditoria pública do lote</p>
          <h1 className="mt-1 break-words font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
            {lot.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <StatusBadge status={lot.displayStatus} />
            <Link className="font-medium underline underline-offset-4" to={`/lotes/${auctionId}`}>
              Abrir a sala do lote
            </Link>
          </div>
        </div>
      </div>
      <section className={cn('flex gap-4 rounded-xl border-2 p-5', verdict.className)} role="status">
        <Icon className="size-10 shrink-0" aria-hidden="true" />
        <div>
          <h2 className="text-xl font-semibold">{verdict.title}</h2>
          <p className="mt-1 text-sm leading-6 text-foreground">{verdict.text}</p>
        </div>
      </section>
      {report.failures.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>O que não conferiu</CardTitle>
            <CardDescription>Cada item é uma verificação que falhou. Nenhum identificador interno é exibido.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              {report.failures.map((failure, index) => (
                <li key={`${failure.code}-${failure.sequence ?? 'lote'}-${index}`} className="text-sm">
                  {failure.sequence ? `Lance ${failure.sequence}: ` : null}
                  {failure.message}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Histórico de lances</CardTitle>
            <CardDescription>Do primeiro ao último. Os participantes aparecem pelo identificador público.</CardDescription>
          </CardHeader>
          <CardContent>
            {report.bids.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Nenhum lance registrado.
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-border">
                {report.bids.map((bid) => (
                  <li key={bid.sequence} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm">
                        <span className="text-muted-foreground">#{bid.sequence}</span>{' '}
                        <span className="font-mono">{bid.bidderPublicId}</span>
                      </p>
                      <p className="text-sm font-semibold tabular-nums">{formatCents(bid.amountCents)}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatWhen(bid.createdAt)}</p>
                    <p className="break-all font-mono text-[11px] leading-5 text-muted-foreground">
                      Assinatura {bid.hash}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Lote</CardTitle>
              <CardDescription className="break-all">Identificador {auctionId}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2 text-sm">
                <Fact label="Leiloeiro" value={lot.sellerPublicId} mono />
                <Fact
                  label="Lance atual"
                  value={lot.currentBidCents === null ? 'Ainda sem lances' : formatCents(lot.currentBidCents)}
                />
                <Fact label="Lances" value={String(lot.bidCount)} />
                <Fact label="Fim" value={formatWhen(lot.endsAt)} />
                <Fact label="Autores" value={lot.authors.length > 0 ? lot.authors.join(', ') : 'Não informado'} />
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Como a verificação funciona</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              Cada lance guarda uma assinatura do seu conteúdo, encadeada à assinatura anterior. O lote guarda a última
              assinatura e outra do estado atual. Esta página recalcula as duas e compara com o que está no banco. Ela não
              altera nem corrige o histórico.
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-label="Carregando auditoria">
      <div className="flex gap-4">
        <Skeleton className="aspect-[2/3] w-16 sm:w-20" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
      <p className="text-sm text-muted-foreground">Carregando auditoria...</p>
    </div>
  );
}
