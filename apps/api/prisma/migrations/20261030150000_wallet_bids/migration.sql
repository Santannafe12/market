-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('DEPOSIT');

-- CreateTable
CREATE TABLE "WalletLedger" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "auctionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" UUID NOT NULL,
    "auctionId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "bidderId" UUID NOT NULL,
    "bidderPublicId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "previousHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "endsAtAfter" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- The committed-balance sum looks up open lots by leader without locking them.
CREATE INDEX "Auction_currentLeaderId_status_idx" ON "Auction"("currentLeaderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_auctionId_sequence_key" ON "Bid"("auctionId", "sequence");

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_amountCents_range" CHECK (
    "amountCents" >= 1 AND "amountCents" <= 2000000000
);

ALTER TABLE "WalletLedger" ADD CONSTRAINT "WalletLedger_balanceAfterCents_range" CHECK (
    "balanceAfterCents" >= 0 AND "balanceAfterCents" <= 2000000000
);

ALTER TABLE "Bid" ADD CONSTRAINT "Bid_sequence_positive" CHECK ("sequence" >= 1);

ALTER TABLE "Bid" ADD CONSTRAINT "Bid_amountCents_range" CHECK (
    "amountCents" >= 1 AND "amountCents" <= 2000000000
);
