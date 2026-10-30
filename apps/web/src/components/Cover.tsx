import { BookOpen } from 'lucide-react';
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
          'flex flex-col items-center justify-center gap-2 bg-muted p-2 text-center text-xs text-muted-foreground',
          className,
        )}
      >
        <BookOpen className="size-6 opacity-60" aria-hidden="true" />
        <span>Sem capa</span>
      </div>
    );
  }

  return (
    <img
      src={coverUrl(auction.id)}
      alt={`Capa de ${auction.title}`}
      loading="lazy"
      className={cn('bg-muted object-cover', className)}
      onError={() => setFailed(true)}
    />
  );
}
