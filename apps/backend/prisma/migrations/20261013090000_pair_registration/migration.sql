ALTER TABLE "EventRegistration" ADD COLUMN "teamId" TEXT, ADD COLUMN "isPairPayer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EventRegistration" ADD CONSTRAINT "EventRegistration_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "EventRegistration_teamId_idx" ON "EventRegistration"("teamId");
