import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

export function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-md border border-destructive/30 bg-card p-3" role="alert">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}
