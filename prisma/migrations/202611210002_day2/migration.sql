BEGIN;
-- CreateEnum
CREATE TYPE "HoldingEventKind" AS ENUM ('OPENING', 'ADJUSTMENT', 'VERIFICATION', 'LEGACY_BASELINE');

-- AlterTable
ALTER TABLE "shareholders" ADD COLUMN     "verificationReference" TEXT;

-- AlterTable
ALTER TABLE "shareholdings" ADD COLUMN     "verificationReference" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "requestId" UUID,
ADD COLUMN     "targetType" TEXT;

-- CreateTable
CREATE TABLE "holding_events" (
    "id" UUID NOT NULL,
    "holdingId" UUID NOT NULL,
    "actorId" UUID,
    "sequence" INTEGER NOT NULL,
    "kind" "HoldingEventKind" NOT NULL,
    "beforeQuantity" BIGINT NOT NULL,
    "delta" BIGINT NOT NULL,
    "afterQuantity" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestId" UUID,

    CONSTRAINT "holding_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "holding_events_holdingId_createdAt_idx" ON "holding_events"("holdingId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetId_createdAt_idx" ON "audit_logs"("targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_holdingId_fkey" FOREIGN KEY ("holdingId") REFERENCES "shareholdings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holding_events" ADD CONSTRAINT "holding_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "holding_events_holdingId_sequence_key" ON "holding_events"("holdingId", "sequence");
-- Preserve snapshots without pretending their source documents have been verified.
INSERT INTO "holding_events" ("id", "holdingId", "sequence", "kind", "beforeQuantity", "delta", "afterQuantity", "reason", "sourceReference", "effectiveAt")
SELECT md5('day2-baseline:' || "id"::text)::uuid, "id", 1, 'LEGACY_BASELINE', 0, "quantity", "quantity",
 'Preserved Day 1 snapshot; source verification required', 'DAY1_UNVERIFIED_SNAPSHOT', "recordedAt" FROM "shareholdings";
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "share_classes" c JOIN "shareholdings" h ON h."shareClassId"=c.id GROUP BY c.id HAVING SUM(h.quantity)>c."issuedShares")
 THEN RAISE EXCEPTION 'Existing holdings exceed class totals; reconcile source records before migration'; END IF;
END $$;
ALTER TABLE "holding_events" ADD CONSTRAINT "event_arithmetic" CHECK ("beforeQuantity">=0 AND "afterQuantity">=0 AND "beforeQuantity"::numeric + "delta"::numeric = "afterQuantity"::numeric);
ALTER TABLE "holding_events" ADD CONSTRAINT "event_evidence" CHECK (length(trim("reason"))>=3 AND length(trim("sourceReference"))>=3 AND "sequence">0);
CREATE TRIGGER holding_events_append_only BEFORE UPDATE OR DELETE ON "holding_events" FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE FUNCTION guard_holding_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Holdings are retained; append a correction instead' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.quantity<>0 OR NEW."verifiedAt" IS NOT NULL OR NEW."verificationReference" IS NOT NULL THEN
   RAISE EXCEPTION 'Create zero snapshot then append a verified opening event' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.id<>OLD.id OR NEW."shareholderId"<>OLD."shareholderId" OR NEW."shareClassId"<>OLD."shareClassId" OR NEW."recordedAt"<>OLD."recordedAt" THEN
   RAISE EXCEPTION 'Holding identity is immutable' USING ERRCODE='23514'; END IF;
  IF pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Snapshots are updated only by ledger events' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shareholdings_ledger_only BEFORE INSERT OR UPDATE OR DELETE ON "shareholdings" FOR EACH ROW EXECUTE FUNCTION guard_holding_snapshot();
CREATE FUNCTION validate_holding_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE h "shareholdings"%ROWTYPE; c "share_classes"%ROWTYPE; p "shareholders"%ROWTYPE; last_sequence integer;
BEGIN
 SELECT * INTO h FROM "shareholdings" WHERE id=NEW."holdingId";
 IF NOT FOUND THEN RAISE EXCEPTION 'Holding not found' USING ERRCODE='23503'; END IF;
 -- All writers take the class lock first, then the holding lock.
 SELECT * INTO c FROM "share_classes" WHERE id=h."shareClassId" FOR UPDATE;
 SELECT * INTO h FROM "shareholdings" WHERE id=NEW."holdingId" FOR UPDATE;
 SELECT * INTO p FROM "shareholders" WHERE id=h."shareholderId" FOR SHARE;
 IF NOT EXISTS (SELECT 1 FROM "users" WHERE id=NEW."actorId" AND role='ADMIN' AND active) THEN RAISE EXCEPTION 'Active administrator actor required' USING ERRCODE='23514'; END IF;
 IF p."verifiedAt" IS NULL OR p."verificationReference" IS NULL THEN RAISE EXCEPTION 'Verified shareholder required' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(MAX(sequence),0) INTO last_sequence FROM "holding_events" WHERE "holdingId"=h.id;
 IF NEW.sequence<>last_sequence+1 OR NEW."beforeQuantity"<>h.quantity THEN RAISE EXCEPTION 'Stale holding event' USING ERRCODE='23514'; END IF;
 IF NEW."effectiveAt">CURRENT_TIMESTAMP OR NEW."verifiedAt">CURRENT_TIMESTAMP THEN RAISE EXCEPTION 'Future dates are invalid' USING ERRCODE='23514'; END IF;
 IF NEW.kind='OPENING' THEN
  IF last_sequence<>0 OR NEW.delta<=0 OR NEW."verifiedAt" IS NULL THEN RAISE EXCEPTION 'Invalid opening event' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='VERIFICATION' THEN
  IF last_sequence=0 OR h."verifiedAt" IS NOT NULL OR NEW.delta<>0 OR NEW."verifiedAt" IS NULL THEN RAISE EXCEPTION 'Invalid baseline verification' USING ERRCODE='23514'; END IF;
 ELSIF NEW.kind='ADJUSTMENT' THEN
  IF h."verifiedAt" IS NULL OR NEW.delta=0 OR NEW."verifiedAt" IS NOT NULL THEN RAISE EXCEPTION 'Verified holding and nonzero correction required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Legacy baselines are migration-only' USING ERRCODE='23514'; END IF;
 IF (SELECT COALESCE(SUM(quantity),0) FROM "shareholdings" WHERE "shareClassId"=c.id) + NEW.delta > c."issuedShares" THEN RAISE EXCEPTION 'Class total exceeded' USING ERRCODE='23514'; END IF;
 NEW."createdAt"=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER holding_event_validate BEFORE INSERT ON "holding_events" FOR EACH ROW EXECUTE FUNCTION validate_holding_event();
CREATE FUNCTION apply_holding_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "shareholdings" SET quantity=NEW."afterQuantity",
 "verifiedAt"=CASE WHEN NEW.kind IN ('OPENING','VERIFICATION') THEN NEW."verifiedAt" ELSE "verifiedAt" END,
 "verificationReference"=CASE WHEN NEW.kind IN ('OPENING','VERIFICATION') THEN NEW."sourceReference" ELSE "verificationReference" END WHERE id=NEW."holdingId";
 INSERT INTO "audit_logs" (id, "actorId", action, "targetId", "targetType", reason, "requestId", metadata)
 VALUES (gen_random_uuid(), NEW."actorId", 'HOLDING_' || NEW.kind::text, NEW."holdingId"::text, 'shareholding', NEW.reason, NEW."requestId",
 jsonb_build_object('eventId',NEW.id,'sequence',NEW.sequence,'beforeQuantity',NEW."beforeQuantity"::text,'delta',NEW.delta::text,'afterQuantity',NEW."afterQuantity"::text,'sourceReference',NEW."sourceReference",'verifiedAt',NEW."verifiedAt",'effectiveAt',NEW."effectiveAt"));
 RETURN NEW;
END $$;
CREATE TRIGGER holding_event_apply AFTER INSERT ON "holding_events" FOR EACH ROW EXECUTE FUNCTION apply_holding_event();
CREATE FUNCTION guard_class_register() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."companyId"<>OLD."companyId" THEN RAISE EXCEPTION 'Cannot move classes between companies' USING ERRCODE='23514'; END IF;
 IF NEW."issuedShares" < (SELECT COALESCE(SUM(quantity),0) FROM "shareholdings" WHERE "shareClassId"=OLD.id) THEN RAISE EXCEPTION 'Class total below recorded holdings' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER share_class_register_guard BEFORE UPDATE ON "share_classes" FOR EACH ROW EXECUTE FUNCTION guard_class_register();
CREATE FUNCTION guard_shareholder_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."userId"<>OLD."userId" THEN RAISE EXCEPTION 'Profile account cannot be reassigned' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "shareholdings" WHERE "shareholderId"=OLD.id) AND (NEW."verifiedAt" IS NULL OR NEW."verificationReference" IS NULL) THEN RAISE EXCEPTION 'Cannot remove verification from a profile with holdings' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shareholder_account_guard BEFORE UPDATE ON "shareholders" FOR EACH ROW EXECUTE FUNCTION guard_shareholder_account();
-- TRUNCATE is a separate SQL operation; row DELETE triggers do not catch it.
CREATE TRIGGER holding_events_no_truncate BEFORE TRUNCATE ON "holding_events" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
COMMIT;
