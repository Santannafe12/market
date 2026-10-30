import { useState } from 'react';
import { coverUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function Cover({
  auction,
  className,
}: {
  auction: { id: string; hasCover: boolean; title: string };
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (!auction.hasCover || failed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center bg-muted text-center text-xs text-muted-foreground',
          className,
        )}
      >
        Sem capa
      </div>
    );
  }

  return (
    <img
      src={coverUrl(auction.id)}
      alt={`Capa de ${auction.title}`}
      className={cn('bg-muted object-cover', className)}
      onError={() => setFailed(true)}
    />
  );
}
