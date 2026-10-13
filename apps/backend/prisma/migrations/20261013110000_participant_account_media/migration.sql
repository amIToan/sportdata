CREATE TABLE "ParticipantAccountMedia" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "type" "AthleteMediaType" NOT NULL,
  "storageKey" TEXT,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "verificationStatus" "DocumentVerificationStatus",
  "verificationNote" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedBy" TEXT,
  "ocrStatus" "DocumentOcrStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "ocrProvider" TEXT,
  "ocrConfidence" DOUBLE PRECISION,
  "ocrData" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ParticipantAccountMedia_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ParticipantAccountMedia_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ParticipantAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ParticipantAccountMedia_accountId_type_key" ON "ParticipantAccountMedia"("accountId", "type");
