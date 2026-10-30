import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AuctionsService, type LotSnapshot } from '../auctions/auctions.service';
import { AuthService } from '../auth/auth.service';
import { BiddingService } from '../bidding/bidding.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from '../settlement/settlement.service';
import { WalletService } from '../wallet/wallet.service';
import { databaseNow } from '../wallet/wallet.sql';

export const DEMO_PASSWORD = 'leilao-demo-2026';
export const DEMO_RECEIPT_TOKEN = 'demo-arremate-bras-cubas';
export const DEMO_DEPOSIT_CENTS = 500_000;

export const DEMO_USERS = {
  seller: { name: 'Leiloeiro Demo', email: 'leiloeiro@demo.local', publicId: 'DEMVEND000', role: Role.SELLER },
  ana: { name: 'Ana Demo', email: 'ana@demo.local', publicId: 'DEMANA0000', role: Role.BIDDER },
  bruno: { name: 'Bruno Demo', email: 'bruno@demo.local', publicId: 'DEMBRVN000', role: Role.BIDDER },
} as const;

export type DemoTag = 'demo-live' | 'demo-scheduled' | 'demo-settled' | 'demo-unsold';

export type DemoReport = {
  skipped: boolean;
  created: DemoTag[];
  deposits: string[];
  problems: string[];
};

const BOOK_BY_TAG: Record<DemoTag, string> = {
  'demo-live': 'OL61352956M',
  'demo-scheduled': 'OL62363757M',
  'demo-settled': 'OL61095027M',
  'demo-unsold': 'OL62256772M',
};

/** Advisory lock id. Two seeds (CLI, boot, scheduler) never interleave their checks and writes. */
const DEMO_LOCK_KEY = 70_072_026;
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const FIXTURES = resolve(__dirname, '../../prisma/fixtures');

type DemoUser = { id: string; publicId: string; email: string };

type FixtureBook = LotSnapshot['edition'] & { cover: string | null; coverContentType: string | null };

/**
 * One idempotent seed. It only creates what is missing and never rewrites a lot from an earlier run:
 * a live or scheduled demo that stopped playing its role stays as it is and a new one is published.
 * Every write goes through the domain services, so money, bids and the HMAC chain are real.
 */
@Injectable()
export class DemoSeed {
  private readonly logger = new Logger(DemoSeed.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly wallet: WalletService,
    private readonly auctions: AuctionsService,
    private readonly bidding: BiddingService,
    private readonly settlement: SettlementService,
  ) {}

  /** The lock transaction only holds the lock. The services open their own transactions. */
  async run(): Promise<DemoReport> {
    const report = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
          SELECT pg_try_advisory_xact_lock(CAST(${DEMO_LOCK_KEY} AS bigint)) AS "locked"
        `;
        if (!rows[0]?.locked) {
          return { skipped: true, created: [], deposits: [], problems: [] } satisfies DemoReport;
        }
        return this.ensure();
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
    if (report.created.length > 0 || report.deposits.length > 0) {
      this.logger.log(
        `Demonstração: criados [${report.created.join(', ')}], depósitos iniciais [${report.deposits.join(', ')}].`,
      );
    }
    for (const problem of report.problems) {
      this.logger.warn(problem);
    }
    return report;
  }

  private async ensure(): Promise<DemoReport> {
    const report: DemoReport = { skipped: false, created: [], deposits: [], problems: [] };
    const books = loadBooks();
    const seller = await this.user(DEMO_USERS.seller);
    const ana = await this.user(DEMO_USERS.ana);
    const bruno = await this.user(DEMO_USERS.bruno);
    for (const bidder of [ana, bruno]) {
      await this.initialDeposit(bidder, report);
    }

    if (!(await this.exists('demo-settled'))) {
      await this.createSettled(seller, ana, bruno, books, report);
    }
    if (!(await this.exists('demo-unsold'))) {
      await this.createUnsold(seller, books, report);
    }
    const now = await databaseNow(this.prisma);
    const scheduled = await this.prisma.auction.count({
      where: { demoTag: 'demo-scheduled', status: 'OPEN', startsAt: { gt: now } },
    });
    if (scheduled === 0) {
      await this.createLot('demo-scheduled', seller, books, {
        startsAt: now.getTime() + 7 * DAY_MS,
        endsAt: now.getTime() + 8 * DAY_MS,
        startingBidCents: 3_000,
        minIncrementCents: 500,
      });
      report.created.push('demo-scheduled');
    }
    const live = await this.prisma.auction.count({
      where: { demoTag: 'demo-live', status: 'OPEN', endsAt: { gt: now } },
    });
    if (live === 0) {
      await this.createLive(seller, ana, bruno, books, report);
    }
    return report;
  }

  private async user(spec: (typeof DEMO_USERS)[keyof typeof DEMO_USERS]): Promise<DemoUser> {
    const existing = await this.prisma.user.findUnique({
      where: { email: spec.email },
      select: { id: true, publicId: true, email: true, role: true },
    });
    if (existing) {
      if (existing.role !== spec.role) {
        throw new Error(`${spec.email} já existe com outro papel; o seed não altera contas.`);
      }
      return existing;
    }
    const { user } = await this.auth.register(
      { name: spec.name, email: spec.email, password: DEMO_PASSWORD, role: spec.role },
      spec.publicId,
    );
    return user;
  }

  private async initialDeposit(user: DemoUser, report: DemoReport) {
    const deposits = await this.prisma.walletLedger.count({
      where: { type: 'DEPOSIT', wallet: { userId: user.id } },
    });
    if (deposits === 0) {
      await this.wallet.deposit(user.id, DEMO_DEPOSIT_CENTS);
      report.deposits.push(user.email);
    }
  }

  /** A cancelled attempt does not count, so a failed first run can be retried. */
  private async exists(tag: DemoTag) {
    const count = await this.prisma.auction.count({ where: { demoTag: tag, status: { not: 'CANCELLED' } } });
    return count > 0;
  }

  private async createLive(seller: DemoUser, ana: DemoUser, bruno: DemoUser, books: Map<string, FixtureBook>, report: DemoReport) {
    const plan: Array<[DemoUser, number]> = [
      [bruno, 1_000],
      [ana, 1_500],
    ];
    const shortfall = await this.shortfall(plan);
    if (shortfall) {
      report.problems.push(`demo-live não foi criado: ${shortfall}`);
      return;
    }
    const now = await databaseNow(this.prisma);
    const lot = await this.createLot('demo-live', seller, books, {
      startsAt: now.getTime() - MINUTE_MS,
      endsAt: now.getTime() + DAY_MS,
      startingBidCents: 1_000,
      minIncrementCents: 500,
    });
    if (await this.bidOrCancel('demo-live', lot.id, seller, plan, report)) {
      report.created.push('demo-live');
    }
  }

  private async createSettled(seller: DemoUser, ana: DemoUser, bruno: DemoUser, books: Map<string, FixtureBook>, report: DemoReport) {
    const plan: Array<[DemoUser, number]> = [
      [ana, 2_000],
      [bruno, 2_500],
    ];
    const shortfall = await this.shortfall(plan);
    if (shortfall) {
      report.problems.push(`demo-settled não foi criado: ${shortfall}`);
      return;
    }
    const now = await databaseNow(this.prisma);
    const lot = await this.createLot('demo-settled', seller, books, {
      startsAt: now.getTime() - MINUTE_MS,
      endsAt: now.getTime() + DAY_MS,
      startingBidCents: 2_000,
      minIncrementCents: 500,
    });
    if (!(await this.bidOrCancel('demo-settled', lot.id, seller, plan, report))) {
      return;
    }
    const ended = await this.settlement.markEnded(lot.id);
    if (ended.outcome !== 'ENDED') {
      report.problems.push(`demo-settled ficou aberto: markEnded respondeu ${ended.outcome}.`);
      return;
    }
    const closed = await this.settlement.finalizeAuction(lot.id, DEMO_RECEIPT_TOKEN);
    if (closed.outcome !== 'SETTLED') {
      report.problems.push(
        `demo-settled foi liquidado por outro ciclo (${closed.outcome}); o comprovante pode ter outro token.`,
      );
      return;
    }
    report.created.push('demo-settled');
  }

  private async createUnsold(seller: DemoUser, books: Map<string, FixtureBook>, report: DemoReport) {
    const now = await databaseNow(this.prisma);
    const lot = await this.createLot('demo-unsold', seller, books, {
      startsAt: now.getTime() - MINUTE_MS,
      endsAt: now.getTime() + DAY_MS,
      startingBidCents: 8_000,
      minIncrementCents: 1_000,
    });
    const ended = await this.settlement.markEnded(lot.id);
    const closed = ended.outcome === 'ENDED' ? await this.settlement.finalizeAuction(lot.id) : null;
    if (closed?.outcome !== 'UNSOLD') {
      report.problems.push(`demo-unsold não fechou nesta execução (${closed?.outcome ?? ended.outcome}).`);
      return;
    }
    report.created.push('demo-unsold');
  }

  private async createLot(
    tag: DemoTag,
    seller: DemoUser,
    books: Map<string, FixtureBook>,
    lot: { startsAt: number; endsAt: number; startingBidCents: number; minIncrementCents: number },
  ) {
    const book = books.get(BOOK_BY_TAG[tag]);
    if (!book) {
      throw new Error(`A fixture não tem a edição ${BOOK_BY_TAG[tag]}.`);
    }
    return this.auctions.createFromSnapshot(
      seller.id,
      {
        startingBidCents: lot.startingBidCents,
        minIncrementCents: lot.minIncrementCents,
        startsAt: new Date(lot.startsAt).toISOString(),
        endsAt: new Date(lot.endsAt).toISOString(),
      },
      snapshotOf(book),
      tag,
    );
  }

  private async shortfall(plan: Array<[DemoUser, number]>) {
    for (const [user, cents] of plan) {
      const view = await this.wallet.view(user.id);
      if (view.availableCents < cents) {
        return `${user.email} tem ${view.availableCents} centavos disponíveis e o lance precisa de ${cents}.`;
      }
    }
    return null;
  }

  /** A failed scripted bid cancels only the lot created in this run, which also releases any commitment. */
  private async bidOrCancel(
    tag: DemoTag,
    auctionId: string,
    seller: DemoUser,
    plan: Array<[DemoUser, number]>,
    report: DemoReport,
  ) {
    for (const [bidder, cents] of plan) {
      try {
        await this.bidding.placeBid(bidder.id, auctionId, cents);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'erro desconhecido';
        report.problems.push(`${tag} cancelado: o lance de ${bidder.email} falhou (${reason}).`);
        try {
          await this.auctions.cancel(seller.id, auctionId);
        } catch (cancelError) {
          const detail = cancelError instanceof Error ? cancelError.message : 'erro desconhecido';
          report.problems.push(`${tag} ${auctionId} não pôde ser cancelado (${detail}).`);
        }
        return false;
      }
    }
    return true;
  }
}

function loadBooks() {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES, 'books.json'), 'utf8')) as { books: FixtureBook[] };
  return new Map(raw.books.map((book) => [book.editionId, book]));
}

function snapshotOf(book: FixtureBook): LotSnapshot {
  const { cover, coverContentType, ...edition } = book;
  return {
    edition,
    cover: cover && coverContentType ? { bytes: readFileSync(resolve(FIXTURES, cover)), contentType: coverContentType } : null,
  };
}
