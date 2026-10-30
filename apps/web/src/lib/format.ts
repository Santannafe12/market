const MONEY_MAX_CENTS = 2_000_000_000;

export function formatCents(cents: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}

export function formatWhen(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  );
}

/** Up to one day: `mm:ss` or `h:mm:ss`. Longer: `2d 03:04:05`. */
export function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, '0')}:${clock}`;
  }
  return hours > 0 ? `${hours}:${clock}` : clock;
}

export type Countdown = { phase: 'starts' | 'ends' | 'over'; ms: number };

/** `now` is the client clock corrected by the server offset. An extended lot simply has a later `endsAt`. */
export function countdown(startsAt: string, endsAt: string, now: number): Countdown {
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (now < start) {
    return { phase: 'starts', ms: start - now };
  }
  if (now < end) {
    return { phase: 'ends', ms: end - now };
  }
  return { phase: 'over', ms: 0 };
}

/** Reais typed by a person: `15`, `15,5`, `1.500,00` or `1500.00`. Returns integer cents or null. */
export function parseReais(value: string) {
  const raw = value.replace(/\s/g, '').replace(/^R\$/i, '');
  const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    return null;
  }
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > MONEY_MAX_CENTS) {
    return null;
  }
  return cents;
}

/** Value for an input that `parseReais` reads back: `1500,00`. */
export function centsToInput(cents: number) {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
