import type { DisplayStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

const labels: Record<DisplayStatus, string> = {
  live: 'Ao vivo',
  scheduled: 'Agendado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

const styles: Record<DisplayStatus, string> = {
  live: 'bg-live text-white',
  scheduled: 'bg-card text-foreground ring-1 ring-border',
  ended: 'bg-muted text-muted-foreground ring-1 ring-border',
  cancelled: 'bg-card text-destructive ring-1 ring-destructive/40',
};

export function StatusBadge({ status, className }: { status: DisplayStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm',
        styles[status],
        className,
      )}
    >
      {status === 'live' ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white/80" />
          <span className="relative inline-flex size-1.5 rounded-full bg-white" />
        </span>
      ) : null}
      {labels[status]}
    </span>
  );
}
