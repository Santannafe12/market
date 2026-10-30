import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/domain-error';
import { DomainEvents } from '../common/domain-events';
import { MONEY_MAX_CENTS } from '../common/money';
import { PrismaService } from '../prisma/prisma.service';
import { committedCents, lockWallet } from './wallet.sql';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
  ) {}

  async view(userId: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balanceCents: true },
    });
    if (!wallet) {
      throw new DomainError('WALLET_NOT_FOUND', 404, 'Carteira não encontrada.');
    }
    const committed = await committedCents(this.prisma, userId);
    return balances(wallet.balanceCents, committed);
  }

  async deposit(userId: string, amountCents: number) {
    assertAmount(amountCents);
    const view = await this.prisma.$transaction(
      async (tx) => {
        const wallet = await lockWallet(tx, userId);
        if (!wallet) {
          throw new DomainError('WALLET_NOT_FOUND', 404, 'Carteira não encontrada.');
        }
        const next = wallet.balanceCents + amountCents;
        if (next > MONEY_MAX_CENTS) {
          throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
        }
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceCents: next },
        });
        await tx.walletLedger.create({
          data: {
            id: randomUUID(),
            walletId: wallet.id,
            type: 'DEPOSIT',
            amountCents,
            balanceAfterCents: next,
          },
        });
        const committed = await committedCents(tx, userId);
        return balances(next, committed);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    this.publish(userId);
    return view;
  }

  private publish(userId: string) {
    try {
      this.events.walletHint(userId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'erro desconhecido';
      this.logger.error(`Falha ao publicar aviso de carteira: ${message}`);
    }
  }
}

function assertAmount(amountCents: number) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 1) {
    throw new DomainError('AMOUNT_INVALID', 422, 'Informe um valor inteiro de pelo menos 1 centavo.');
  }
  if (amountCents > MONEY_MAX_CENTS) {
    throw new DomainError('AMOUNT_OVERFLOW', 422, 'Esse valor passa do limite permitido.');
  }
}

function balances(balanceCents: number, committed: number) {
  return {
    balanceCents,
    committedCents: committed,
    availableCents: balanceCents - committed,
  };
}
