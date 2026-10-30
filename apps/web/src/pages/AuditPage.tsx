import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { InlineError, errorMessage } from '@/components/InlineError';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getAudit, type AuditVerdict } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';
import { cn } from '@/lib/utils';

const verdictCopy: Record<AuditVerdict, { title: string; text: string; className: string }> = {
  INTEGRO: {
    title: 'Íntegro',
    text: 'O histórico confere. As assinaturas, a sequência e o estado do lote estão de acordo.',
    className: 'border-primary bg-card',
  },
  ADULTERADO: {
    title: 'Adulterado',
    text: 'O histórico não confere. Alguma informação foi alterada depois de registrada.',
    className: 'border-destructive bg-destructive/10',
  },
  INDETERMINADO: {
    title: 'Indeterminado',
    text: 'Não foi possível concluir a verificação. Isso não significa que o histórico esteja íntegro.',
    className: 'border-border bg-muted',
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
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <span className="text-base font-semibold">Casa de Leilões</span>
          <Link className="text-sm font-medium underline" to="/entrar">
            Entrar
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
        {!auctionId || report.isPending ? <p className="text-sm text-muted-foreground">Carregando auditoria...</p> : null}
        {report.isError ? (
          <InlineError
            message={errorMessage(report.error, 'Não foi possível abrir a auditoria deste lote.')}
            onRetry={() => void report.refetch()}
          />
        ) : null}
        {report.data ? <ReportBody auctionId={auctionId ?? ''} report={report.data} /> : null}
      </main>
    </div>
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
  const lot = report.auction;
  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">Auditoria pública do lote</p>
        <h1 className="text-2xl font-semibold tracking-tight">{lot.title}</h1>
      </div>
      <section className={cn('rounded-lg border-2 p-4', verdict.className)} role="status">
        <h2 className="text-lg font-semibold">{verdict.title}</h2>
        <p className="mt-1 text-sm leading-6">{verdict.text}</p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Cada lance guarda uma assinatura do seu conteúdo. O lote guarda a última assinatura e outra do
          estado atual. Esta página recalcula as duas e compara com o que está no banco. Ela não altera nem
          corrige o histórico.
        </p>
      </section>
      {report.failures.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">O que não conferiu</CardTitle>
            <CardDescription>Cada item é uma verificação que falhou. Nenhum identificador interno é exibido.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
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
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lote</CardTitle>
          <CardDescription>Identificador do lote: {auctionId}</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Leiloeiro" value={lot.sellerPublicId} />
            <Fact label="Lance atual" value={lot.currentBidCents === null ? 'Ainda sem lances' : formatCents(lot.currentBidCents)} />
            <Fact label="Lances" value={String(lot.bidCount)} />
            <Fact label="Fim" value={formatWhen(lot.endsAt)} />
            <Fact label="Autores" value={lot.authors.length > 0 ? lot.authors.join(', ') : 'Não informado'} />
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Histórico de lances</CardTitle>
          <CardDescription>Os participantes aparecem pelo identificador público.</CardDescription>
        </CardHeader>
        <CardContent>
          {report.bids.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lance registrado.</p>
          ) : (
            <ol className="flex flex-col gap-4">
              {report.bids.map((bid) => (
                <li key={bid.sequence} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                  <p className="text-sm font-medium">
                    #{bid.sequence} · {bid.bidderPublicId} · {formatCents(bid.amountCents)}
                  </p>
                  <p className="text-sm text-muted-foreground">{formatWhen(bid.createdAt)}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Assinatura {bid.hash}</p>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}
