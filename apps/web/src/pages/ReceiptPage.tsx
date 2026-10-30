import { useQuery } from '@tanstack/react-query';
import { Award, Check, Copy, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PublicLayout } from '@/components/AppLayout';
import { InlineError, errorMessage } from '@/components/InlineError';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getReceipt } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';

export function ReceiptPage() {
  const { token } = useParams();
  const [copied, setCopied] = useState(false);
  const receipt = useQuery({
    queryKey: ['receipt', token],
    queryFn: () => getReceipt(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <PublicLayout>
      <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
        {!token || receipt.isPending ? (
          <div className="flex flex-col gap-4" aria-label="Carregando comprovante">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-72 w-full" />
            <p className="text-sm text-muted-foreground">Carregando comprovante...</p>
          </div>
        ) : null}
        {receipt.isError ? (
          <InlineError
            message={errorMessage(receipt.error, 'Comprovante não encontrado.')}
            onRetry={() => void receipt.refetch()}
          />
        ) : null}
        {receipt.data ? (
          <Card className="overflow-hidden">
            <div className="flex flex-col items-center gap-2 border-b border-border bg-muted/50 px-6 py-8 text-center">
              <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Award className="size-6" aria-hidden="true" />
              </span>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Comprovante de arremate</p>
              <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
                {receipt.data.title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">Valor arrematado</p>
              <p className="font-display text-4xl font-semibold tabular-nums">{formatCents(receipt.data.amountCents)}</p>
            </div>
            <CardContent className="flex flex-col gap-5 p-6 sm:p-6">
              <dl className="flex flex-col gap-3 text-sm">
                <Row label="Licitante vencedor" value={receipt.data.winnerPublicId} mono />
                <Row label="Leiloeiro" value={receipt.data.sellerPublicId} mono />
                <Row label="Emitido em" value={formatWhen(receipt.data.createdAt)} />
                <Row label="Código" value={receipt.data.publicToken} mono />
              </dl>
              <p className="text-xs leading-5 text-muted-foreground">
                Este link é público. Ele mostra só o identificador de cada participante, sem nome nem e-mail.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button asChild>
                  <Link to={`/auditoria/${receipt.data.auctionId}`}>
                    <ShieldCheck />
                    Ver auditoria do lote
                  </Link>
                </Button>
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check /> : <Copy />}
                  {copied ? 'Link copiado' : 'Copiar link'}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PublicLayout>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border pb-3 last:border-0 last:pb-0 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'break-all font-mono' : undefined}>{value}</dd>
    </div>
  );
}
