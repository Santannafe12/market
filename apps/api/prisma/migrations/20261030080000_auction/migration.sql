-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('OPEN', 'CANCELLED');

-- CreateTable
CREATE TABLE "Auction" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "sellerPublicId" TEXT NOT NULL,
    "status" "AuctionStatus" NOT NULL,
    "startingBidCents" INTEGER NOT NULL,
    "minIncrementCents" INTEGER NOT NULL,
    "currentBidCents" INTEGER,
    "currentLeaderId" UUID,
    "currentLeaderPublicId" TEXT,
    "bidCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "originalEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "editionId" TEXT NOT NULL,
    "workId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "authors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "publisher" TEXT,
    "publishedDate" TEXT,
    "publishedYear" INTEGER,
    "isbn" TEXT,
    "language" TEXT,
    "description" VARCHAR(4000),
    "coverImage" BYTEA,
    "coverContentType" TEXT,
    "auditHeadHash" TEXT NOT NULL,
    "auditStateMac" TEXT NOT NULL,
    "auditKeyVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Auction_status_endsAt_idx" ON "Auction"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Auction_sellerId_idx" ON "Auction"("sellerId");

-- AddForeignKey
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The end is strictly after the start. Listing states come from the clock, not from a cron.
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_window_valid" CHECK ("endsAt" > "startsAt");

-- bidCount = 0 only with a null bid and a null leader. A positive count keeps both.
ALTER TABLE "Auction" ADD CONSTRAINT "Auction_bid_coherence" CHECK (
    "bidCount" >= 0
    AND (
        (
            "bidCount" = 0
            AND "currentBidCents" IS NULL
            AND "currentLeaderId" IS NULL
            AND "currentLeaderPublicId" IS NULL
        )
        OR (
            "bidCount" > 0
            AND "currentBidCents" IS NOT NULL
            AND "currentLeaderId" IS NOT NULL
            AND "currentLeaderPublicId" IS NOT NULL
        )
    )
);

ALTER TABLE "Auction" ADD CONSTRAINT "Auction_startingBidCents_range" CHECK (
    "startingBidCents" >= 1 AND "startingBidCents" <= 2000000000
);

ALTER TABLE "Auction" ADD CONSTRAINT "Auction_minIncrementCents_range" CHECK (
    "minIncrementCents" >= 1 AND "minIncrementCents" <= 2000000000
);

ALTER TABLE "Auction" ADD CONSTRAINT "Auction_currentBidCents_range" CHECK (
    "currentBidCents" IS NULL
    OR ("currentBidCents" >= 1 AND "currentBidCents" <= 2000000000)
);
