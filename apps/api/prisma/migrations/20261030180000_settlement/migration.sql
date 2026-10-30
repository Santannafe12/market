-- Settlement closes a lot once. The receipt unique on auctionId is the last net if two transactions pass the lock.
ALTER TYPE "AuctionStatus" ADD VALUE IF NOT EXISTS 'SETTLED';
ALTER TYPE "AuctionStatus" ADD VALUE IF NOT EXISTS 'UNSOLD';
ALTER TYPE "WalletEntryType" ADD VALUE IF NOT EXISTS 'SETTLEMENT_DEBIT';
ALTER TYPE "WalletEntryType" ADD VALUE IF NOT EXISTS 'SETTLEMENT_CREDIT';

CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "publicToken" TEXT NOT NULL,
    "auctionId" UUID NOT NULL,
    "winnerPublicId" TEXT NOT NULL,
    "sellerPublicId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Receipt_publicToken_key" ON "Receipt"("publicToken");

CREATE UNIQUE INDEX "Receipt_auctionId_key" ON "Receipt"("auctionId");

ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "Auction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_amountCents_range" CHECK (
    "amountCents" >= 1 AND "amountCents" <= 2000000000
);
