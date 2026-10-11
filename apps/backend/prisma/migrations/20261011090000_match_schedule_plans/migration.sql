-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "weightKind" TEXT;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "schedulePlanId" TEXT,
ADD COLUMN     "scheduleRevisionId" TEXT,
ADD COLUMN     "scheduleSequence" INTEGER,
ADD COLUMN     "scheduleWindowId" TEXT;

-- CreateTable
CREATE TABLE "MatchSchedulePlan" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
    "draftVersion" INTEGER NOT NULL DEFAULT 0,
    "appliedRevisionId" TEXT,
    "createKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchSchedulePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScheduleRevision" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "draftVersion" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "proposal" JSONB NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedBy" TEXT,
    "applyKey" TEXT,
    "applyHash" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchScheduleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScheduleItem" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "chainSequence" INTEGER NOT NULL,
    "windowId" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "fopId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "stageKey" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "turnaroundSeconds" INTEGER NOT NULL,

    CONSTRAINT "MatchScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchScheduleCategory" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,

    CONSTRAINT "MatchScheduleCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchSchedulePlan_eventId_idx" ON "MatchSchedulePlan"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchSchedulePlan_eventId_createKey_key" ON "MatchSchedulePlan"("eventId", "createKey");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScheduleRevision_applyKey_key" ON "MatchScheduleRevision"("applyKey");

-- CreateIndex
CREATE INDEX "MatchScheduleRevision_planId_createdAt_idx" ON "MatchScheduleRevision"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "MatchScheduleItem_matchId_idx" ON "MatchScheduleItem"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScheduleItem_revisionId_matchId_key" ON "MatchScheduleItem"("revisionId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScheduleItem_revisionId_chainSequence_key" ON "MatchScheduleItem"("revisionId", "chainSequence");

-- CreateIndex
CREATE INDEX "MatchScheduleCategory_planId_idx" ON "MatchScheduleCategory"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchScheduleCategory_eventId_categoryId_key" ON "MatchScheduleCategory"("eventId", "categoryId");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_schedulePlanId_fkey" FOREIGN KEY ("schedulePlanId") REFERENCES "MatchSchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchSchedulePlan" ADD CONSTRAINT "MatchSchedulePlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScheduleRevision" ADD CONSTRAINT "MatchScheduleRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MatchSchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScheduleItem" ADD CONSTRAINT "MatchScheduleItem_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "MatchScheduleRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScheduleItem" ADD CONSTRAINT "MatchScheduleItem_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScheduleCategory" ADD CONSTRAINT "MatchScheduleCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchScheduleCategory" ADD CONSTRAINT "MatchScheduleCategory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MatchSchedulePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Current assignments live on Match (one row per match). History lives in items.
ALTER TABLE "Match" ADD CONSTRAINT "Match_plan_sequence_key" UNIQUE ("schedulePlanId", "scheduleSequence") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "Match" ADD CONSTRAINT "Match_schedule_revision_fkey" FOREIGN KEY ("scheduleRevisionId") REFERENCES "MatchScheduleRevision"("id") ON DELETE RESTRICT;
ALTER TABLE "Match" ADD CONSTRAINT "Match_complete_assignment" CHECK (
  ("schedulePlanId" IS NULL AND "scheduleRevisionId" IS NULL AND "scheduleSequence" IS NULL AND "scheduleWindowId" IS NULL)
  OR ("schedulePlanId" IS NOT NULL AND "scheduleRevisionId" IS NOT NULL AND "scheduleSequence" > 0 AND "scheduleWindowId" IS NOT NULL));
ALTER TABLE "MatchScheduleItem" ADD CONSTRAINT "MatchScheduleItem_valid_interval" CHECK ("endTime" > "startTime" AND "turnaroundSeconds" >= 0);
ALTER TABLE "Category" ADD CONSTRAINT "Category_weight_kind" CHECK ("weightKind" IS NULL OR "weightKind" IN ('CAPPED', 'OVER', 'OPEN'));

-- Writers outside the planner invalidate its event snapshot too. Updating the
-- Event row makes a serializable transaction which waited for a writer fail
-- instead of reading a snapshot taken before it acquired the advisory lock.
CREATE FUNCTION sportdata_schedule_snapshot_changed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  old_row jsonb;
  new_row jsonb;
  event_ids text[];
  event_id text;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP <> 'DELETE' THEN new_row := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME IN ('Match', 'Draw', 'Fop', 'CompetitionEntry', 'Team', 'SportSchedulingRule', 'CompetitionSession', 'Heat', 'RoundRobinGroup') THEN
    event_ids := ARRAY[old_row->>'eventId', new_row->>'eventId'];
  ELSIF TG_TABLE_NAME = 'TeamMember' THEN
    SELECT array_agg("eventId") INTO event_ids FROM "Team" WHERE "id" IN (old_row->>'teamId', new_row->>'teamId');
  ELSIF TG_TABLE_NAME = 'TimeSlot' THEN
    SELECT array_agg("eventId") INTO event_ids FROM "CompetitionSession" WHERE "id" IN (old_row->>'sessionId', new_row->>'sessionId');
  ELSIF TG_TABLE_NAME = 'MatchParticipant' THEN
    SELECT array_agg("eventId") INTO event_ids FROM "Match" WHERE "id" IN (old_row->>'matchId', new_row->>'matchId');
  ELSIF TG_TABLE_NAME = 'HeatLane' THEN
    SELECT array_agg("eventId") INTO event_ids FROM "Heat" WHERE "id" IN (old_row->>'heatId', new_row->>'heatId');
  ELSIF TG_TABLE_NAME = 'Category' THEN
    SELECT array_agg("B") INTO event_ids FROM "_CategoryToEvent" WHERE "A" IN (old_row->>'id', new_row->>'id');
  ELSIF TG_TABLE_NAME = '_CategoryToEvent' THEN
    event_ids := ARRAY[old_row->>'B', new_row->>'B'];
  ELSIF TG_TABLE_NAME = 'Venue' THEN
    SELECT array_agg("eventId") INTO event_ids FROM "Fop" WHERE "venueId" IN (old_row->>'id', new_row->>'id');
  END IF;
  FOR event_id IN SELECT DISTINCT value FROM unnest(event_ids) AS value WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM pg_advisory_xact_lock(hashtext(event_id));
    UPDATE "Event" SET "updatedAt" = clock_timestamp() WHERE "id" = event_id;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Match', 'Draw', 'Fop', 'CompetitionEntry', 'Team', 'SportSchedulingRule', 'CompetitionSession', 'Heat', 'RoundRobinGroup', 'TeamMember', 'TimeSlot', 'MatchParticipant', 'HeatLane', 'Category', '_CategoryToEvent', 'Venue'] LOOP
    EXECUTE format('CREATE TRIGGER schedule_snapshot_changed BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION sportdata_schedule_snapshot_changed()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION sportdata_protect_managed_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE apply_plan text := current_setting('sportdata.schedule_apply', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "MatchScheduleCategory" WHERE "eventId" = NEW."eventId" AND "categoryId" = NEW."categoryId") THEN
      RAISE EXCEPTION 'Hạng đang thuộc lịch đã áp dụng; không thêm hoặc sinh lại trận.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."schedulePlanId" IS NOT NULL OR EXISTS (SELECT 1 FROM "MatchScheduleCategory" WHERE "eventId" = OLD."eventId" AND "categoryId" = OLD."categoryId") THEN
      RAISE EXCEPTION 'Nhánh đang thuộc lịch đã áp dụng; không thể xóa hoặc thu hồi.';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."schedulePlanId" IS NOT NULL AND (NEW."eventId", NEW."categoryId", NEW."drawId", NEW."round", NEW."bracketPosition", NEW."matchNumber", NEW."winnerToMatchId", NEW."loserToMatchId", NEW."winnerToSide", NEW."loserToSide")
    IS DISTINCT FROM (OLD."eventId", OLD."categoryId", OLD."drawId", OLD."round", OLD."bracketPosition", OLD."matchNumber", OLD."winnerToMatchId", OLD."loserToMatchId", OLD."winnerToSide", OLD."loserToSide") THEN
    RAISE EXCEPTION 'Trận thuộc lịch đã áp dụng; không sửa topology hoặc mã trận.';
  END IF;
  IF (OLD."schedulePlanId" IS NOT NULL OR NEW."schedulePlanId" IS NOT NULL)
    AND (NEW."matchDate", NEW."startTime", NEW."endTime", NEW."fopId", NEW."fop", NEW."sessionId", NEW."timeSlotId", NEW."schedulePlanId", NEW."scheduleRevisionId", NEW."scheduleSequence", NEW."scheduleWindowId")
      IS DISTINCT FROM (OLD."matchDate", OLD."startTime", OLD."endTime", OLD."fopId", OLD."fop", OLD."sessionId", OLD."timeSlotId", OLD."schedulePlanId", OLD."scheduleRevisionId", OLD."scheduleSequence", OLD."scheduleWindowId")
    AND (apply_plan IS NULL OR apply_plan = '' OR apply_plan <> coalesce(NEW."schedulePlanId", OLD."schedulePlanId")) THEN
    RAISE EXCEPTION 'Mở Sắp xếp trận đấu để sửa lịch thuộc kế hoạch.';
  END IF;
  IF OLD."schedulePlanId" IS NOT NULL AND NEW."status" = 'CANCELLED' AND OLD."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Không thể hủy trực tiếp trận thuộc lịch đã áp dụng.';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_managed_match BEFORE INSERT OR UPDATE OR DELETE ON "Match" FOR EACH ROW EXECUTE FUNCTION sportdata_protect_managed_match();

CREATE FUNCTION sportdata_immutable_applied_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."appliedAt" IS NOT NULL THEN RAISE EXCEPTION 'Lịch sử đã áp dụng không được sửa hoặc xóa.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER immutable_applied_revision BEFORE UPDATE OR DELETE ON "MatchScheduleRevision" FOR EACH ROW EXECUTE FUNCTION sportdata_immutable_applied_revision();

CREATE FUNCTION sportdata_match_participant_keys(match_id text, a1 text, a2 text, t1 text, t2 text)
RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(DISTINCT key), ARRAY[]::text[]) FROM (
    SELECT 'athlete:' || value AS key FROM unnest(ARRAY[a1, a2]) value WHERE value IS NOT NULL
    UNION SELECT 'team:' || value FROM unnest(ARRAY[t1, t2]) value WHERE value IS NOT NULL
    UNION SELECT 'athlete:' || "athleteId" FROM "TeamMember" WHERE "teamId" IN (t1, t2)
    UNION SELECT 'athlete:' || "athleteId" FROM "MatchParticipant" WHERE "matchId" = match_id AND "athleteId" IS NOT NULL
    UNION SELECT 'team:' || "teamId" FROM "MatchParticipant" WHERE "matchId" = match_id AND "teamId" IS NOT NULL
    UNION SELECT 'athlete:' || member."athleteId" FROM "MatchParticipant" participant JOIN "TeamMember" member ON member."teamId" = participant."teamId" WHERE participant."matchId" = match_id
  ) participants
$$;

-- Protect managed reservations against legacy writers, including different mats
-- with the same team member. Participant resolution itself is allowed: actual
-- results must remain recordable, and readiness rechecks the resolved athletes.
CREATE FUNCTION sportdata_schedule_validate_interval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  other record;
  new_rest integer;
  new_gap integer;
  old_rest integer;
  old_gap integer;
  keys text[];
  effective_start timestamp;
  effective_end timestamp;
BEGIN
  IF NEW."startTime" IS NULL OR NEW."endTime" IS NULL OR NEW."status" = 'CANCELLED' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND (NEW."startTime", NEW."endTime", NEW."fopId", NEW."eventId")
    IS NOT DISTINCT FROM (OLD."startTime", OLD."endTime", OLD."fopId", OLD."eventId") THEN RETURN NEW; END IF;
  SELECT coalesce(rule."minRestMinutes", 60), coalesce(rule."turnaroundMinutes", 5) * 60 INTO new_rest, new_gap
    FROM "Category" category LEFT JOIN "SportSchedulingRule" rule ON rule."sportId" = category."sportId" AND rule."eventId" = NEW."eventId"
    WHERE category."id" = NEW."categoryId";
  IF NEW."scheduleRevisionId" IS NOT NULL THEN
    SELECT coalesce((item->>'turnaroundSeconds')::integer, new_gap) INTO new_gap
      FROM "MatchScheduleRevision" revision, jsonb_array_elements(revision."proposal"->'assignments') item
      WHERE revision."id" = NEW."scheduleRevisionId" AND item->>'matchId' = NEW."id";
  END IF;
  keys := sportdata_match_participant_keys(NEW."id", NEW."athlete1Id", NEW."athlete2Id", NEW."team1Id", NEW."team2Id");
  FOR other IN SELECT * FROM "Match" WHERE "eventId" = NEW."eventId" AND "id" <> NEW."id" AND "status" <> 'CANCELLED'
    AND "startTime" IS NOT NULL AND "endTime" IS NOT NULL AND (NEW."schedulePlanId" IS NOT NULL OR "schedulePlanId" IS NOT NULL)
    AND NOT ("drawId" IS NOT NULL AND "status" = 'FINISHED' AND "winMethod" = 'WALKOVVER' AND "resultStatus" = 'DRAFT'
      AND "resultEnteredAt" IS NULL AND "notes" LIKE 'Generated %' AND coalesce("resultData"->'scoreboard', 'null'::jsonb) = 'null'::jsonb
      AND (coalesce("athlete1Id", "team1Id") IS NULL OR coalesce("athlete2Id", "team2Id") IS NULL)) LOOP
    SELECT coalesce(rule."minRestMinutes", 60), coalesce(rule."turnaroundMinutes", 5) * 60 INTO old_rest, old_gap
      FROM "Category" category LEFT JOIN "SportSchedulingRule" rule ON rule."sportId" = category."sportId" AND rule."eventId" = NEW."eventId"
      WHERE category."id" = other."categoryId";
    IF other."scheduleRevisionId" IS NOT NULL THEN
      SELECT coalesce((item->>'turnaroundSeconds')::integer, old_gap) INTO old_gap
        FROM "MatchScheduleRevision" revision, jsonb_array_elements(revision."proposal"->'assignments') item
        WHERE revision."id" = other."scheduleRevisionId" AND item->>'matchId' = other."id";
    END IF;
    effective_start := coalesce((other."resultData" #>> '{scoreboard,startedAt}')::timestamptz AT TIME ZONE 'UTC', other."startTime");
    effective_end := CASE WHEN other."status" = 'FINISHED' THEN coalesce((other."resultData" #>> '{scoreboard,finishedAt}')::timestamptz AT TIME ZONE 'UTC', other."endTime") ELSE other."endTime" END;
    IF NEW."fopId" = other."fopId" AND NEW."startTime" < effective_end + make_interval(secs => old_gap)
      AND NEW."endTime" + make_interval(secs => new_gap) > effective_start THEN
      RAISE EXCEPTION 'Thảm hoặc thời gian chuyển trận xung đột với trận %', other."id" USING ERRCODE = '23P01';
    END IF;
    IF keys && sportdata_match_participant_keys(other."id", other."athlete1Id", other."athlete2Id", other."team1Id", other."team2Id")
      AND NEW."startTime" < effective_end + make_interval(mins => greatest(new_rest, old_rest))
      AND NEW."endTime" + make_interval(mins => greatest(new_rest, old_rest)) > effective_start THEN
      RAISE EXCEPTION 'VĐV/đội bị trùng giờ hoặc thiếu thời gian nghỉ với trận %', other."id" USING ERRCODE = '23P01';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER schedule_validate_interval BEFORE INSERT OR UPDATE ON "Match" FOR EACH ROW EXECUTE FUNCTION sportdata_schedule_validate_interval();
