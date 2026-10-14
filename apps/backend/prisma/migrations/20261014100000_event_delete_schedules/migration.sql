-- Permit schedule cleanup only for the event being deleted in this transaction.
-- Direct match deletion and applied-revision updates remain protected.
CREATE OR REPLACE FUNCTION sportdata_protect_managed_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE apply_plan text := current_setting('sportdata.schedule_apply', true);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM "MatchScheduleCategory" WHERE "eventId" = NEW."eventId" AND "categoryId" = NEW."categoryId") THEN
      RAISE EXCEPTION 'Hạng đang thuộc lịch đã áp dụng; không thêm hoặc sinh lại trận.';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."eventId" = current_setting('sportdata.event_delete', true) THEN RETURN OLD; END IF;
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

CREATE OR REPLACE FUNCTION sportdata_immutable_applied_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM "MatchSchedulePlan"
    WHERE "id" = OLD."planId" AND "eventId" = current_setting('sportdata.event_delete', true)
  ) THEN
    RETURN OLD;
  END IF;
  IF OLD."appliedAt" IS NOT NULL THEN RAISE EXCEPTION 'Lịch sử đã áp dụng không được sửa hoặc xóa.'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
