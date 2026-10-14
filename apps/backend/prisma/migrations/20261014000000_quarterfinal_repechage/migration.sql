-- Preserve enum-backed draw/configuration records. Saved JSON previews must be rebuilt.
ALTER TYPE "DrawType" RENAME VALUE 'REPECHAGE_ROUND_OF_16' TO 'REPECHAGE_QUARTERFINALS';
UPDATE "DrawPreconfiguration"
SET "plan" = NULL, "inputVersion" = NULL
WHERE "drawType" = 'REPECHAGE_QUARTERFINALS';
