import { centsToInput, countdown, formatCents, formatRemaining, parseReais } from '../../web/src/lib/format';

const nbsp = (text: string) => text.replace(/\u00a0/g, ' ');

describe('web money and countdown helpers', () => {
  it('formats cents as BRL and reads reais typed by a person back into the same cents', () => {
    expect(nbsp(formatCents(1_500))).toBe('R$ 15,00');
    expect(nbsp(formatCents(1))).toBe('R$ 0,01');
    expect(nbsp(formatCents(2_000_000_000))).toBe('R$ 20.000.000,00');

    expect(parseReais('15')).toBe(1_500);
    expect(parseReais('15,5')).toBe(1_550);
    expect(parseReais('R$ 1.500,00')).toBe(150_000);
    expect(parseReais('1500.00')).toBe(150_000);
    expect(parseReais('0,01')).toBe(1);
    expect(parseReais(centsToInput(123_456))).toBe(123_456);
    for (const invalid of ['', '0', '0,00', '-5', '1,234', '1.500', 'abc', '20000000,01']) {
      expect(parseReais(invalid)).toBeNull();
    }
  });

  it('counts down to the start, to the end, to an extended end, and stops at zero', () => {
    const startsAt = '2026-10-30T12:00:00.000Z';
    const endsAt = '2026-10-30T13:00:00.000Z';
    const now = Date.parse('2026-10-30T12:58:30.000Z');

    expect(countdown(startsAt, endsAt, Date.parse('2026-10-30T11:59:00.000Z'))).toEqual({ phase: 'starts', ms: 60_000 });
    expect(countdown(startsAt, endsAt, now)).toEqual({ phase: 'ends', ms: 90_000 });
    expect(formatRemaining(countdown(startsAt, endsAt, now).ms)).toBe('01:30');
    const extended = countdown(startsAt, '2026-10-30T13:02:00.000Z', now);
    expect(extended).toEqual({ phase: 'ends', ms: 210_000 });
    expect(formatRemaining(extended.ms)).toBe('03:30');
    expect(countdown(startsAt, endsAt, Date.parse('2026-10-30T13:00:00.000Z'))).toEqual({ phase: 'over', ms: 0 });

    expect(formatRemaining(0)).toBe('00:00');
    expect(formatRemaining(999)).toBe('00:01');
    expect(formatRemaining(3_600_000 + 5_000)).toBe('1:00:05');
    expect(formatRemaining(7 * 86_400_000 + 3_723_000)).toBe('7d 01:02:03');
  });
});
