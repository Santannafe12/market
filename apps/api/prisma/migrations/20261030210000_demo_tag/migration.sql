-- Demo scenario of a lot written by the seed. Not unique: a renewed live demo keeps the old row with the same tag.
ALTER TABLE "Auction" ADD COLUMN "demoTag" TEXT;

CREATE INDEX "Auction_demoTag_idx" ON "Auction"("demoTag");
