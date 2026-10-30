import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { InlineError, errorMessage } from '@/components/InlineError';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getReceipt } from '@/lib/api';
import { formatCents, formatWhen } from '@/lib/format';

export function ReceiptPage() {
  const { token } = useParams();
  const receipt = useQuery({
    queryKey: ['receipt', token],
    queryFn: () => getReceipt(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-8">
      <div>
        <p className="text-sm text-muted-foreground">Casa de Leilões</p>
        <h1 className="text-2xl font-semibold tracking-tight">Comprovante de arremate</h1>
      </div>
      {!token || receipt.isPending ? <p className="text-sm text-muted-foreground">Carregando comprovante...</p> : null}
      {receipt.isError ? (
        <InlineError
          message={errorMessage(receipt.error, 'Comprovante não encontrado.')}
          onRetry={() => void receipt.refetch()}
        />
      ) : null}
      {receipt.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{receipt.data.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p>
              <span className="text-muted-foreground">Valor arrematado: </span>
              {formatCents(receipt.data.amountCents)}
            </p>
            <p>
              <span className="text-muted-foreground">Licitante: </span>
              {receipt.data.winnerPublicId}
            </p>
            <p>
              <span className="text-muted-foreground">Leiloeiro: </span>
              {receipt.data.sellerPublicId}
            </p>
            <p>
              <span className="text-muted-foreground">Emitido em: </span>
              {formatWhen(receipt.data.createdAt)}
            </p>
            <p className="text-muted-foreground">
              Este link é público. Ele mostra só o identificador de cada participante, sem nome nem e-mail.
            </p>
            <Link className="font-medium underline" to={`/auditoria/${receipt.data.auctionId}`}>
              Ver auditoria do lote
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </main>
  );
}
