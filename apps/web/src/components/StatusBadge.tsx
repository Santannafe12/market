import type { DisplayStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

const labels: Record<DisplayStatus, string> = {
  live: 'Ao vivo',
  scheduled: 'Agendado',
  ended: 'Encerrado',
  cancelled: 'Cancelado',
};

const styles: Record<DisplayStatus, string> = {
  live: 'bg-primary text-primary-foreground',
  scheduled: 'bg-muted text-foreground',
  ended: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
};

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', styles[status])}>
      {labels[status]}
    </span>
  );
}
