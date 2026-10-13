ALTER TABLE "EventParticipation"
  ADD COLUMN "identityType" TEXT,
  ADD COLUMN "documentEncrypted" TEXT;

CREATE TABLE "EventParticipationMedia" (
  "id" TEXT NOT NULL,
  "participationId" TEXT NOT NULL,
  "type" "AthleteMediaType" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "verificationStatus" "DocumentVerificationStatus",
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventParticipationMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventParticipationMedia_participationId_fkey" FOREIGN KEY ("participationId") REFERENCES "EventParticipation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "EventParticipationMedia_participationId_type_key" ON "EventParticipationMedia"("participationId", "type");
