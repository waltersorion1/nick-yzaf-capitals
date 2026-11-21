BEGIN;
-- CreateEnum
CREATE TYPE "DividendStatus" AS ENUM ('DECLARED', 'PAID');

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "datedAt" DATE NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "valuation_snapshots" (
    "id" UUID NOT NULL,
    "shareClassId" UUID NOT NULL,
    "asOf" DATE NOT NULL,
    "pricePerShare" DECIMAL(28,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "methodology" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "valuation_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dividend_records" (
    "id" UUID NOT NULL,
    "shareholderId" UUID NOT NULL,
    "shareClassId" UUID NOT NULL,
    "status" "DividendStatus" NOT NULL,
    "declarationId" UUID,
    "amount" DECIMAL(28,8) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "datedAt" DATE NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),

    CONSTRAINT "dividend_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_companyId_datedAt_idx" ON "announcements"("companyId", "datedAt");

-- CreateIndex
CREATE INDEX "valuation_snapshots_shareClassId_asOf_idx" ON "valuation_snapshots"("shareClassId", "asOf");

-- CreateIndex
CREATE INDEX "dividend_records_shareholderId_datedAt_idx" ON "dividend_records"("shareholderId", "datedAt");

-- CreateIndex
CREATE UNIQUE INDEX "dividend_records_shareholderId_shareClassId_reference_key" ON "dividend_records"("shareholderId", "shareClassId", "reference");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "valuation_snapshots" ADD CONSTRAINT "valuation_snapshots_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_records" ADD CONSTRAINT "dividend_records_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_records" ADD CONSTRAINT "dividend_records_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividend_records" ADD CONSTRAINT "dividend_records_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "dividend_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only one current source snapshot for a class/date; corrected sources must withdraw the old record.
CREATE UNIQUE INDEX valuation_active_class_date ON valuation_snapshots("shareClassId","asOf") WHERE "withdrawnAt" IS NULL;
ALTER TABLE valuation_snapshots ADD CONSTRAINT valuation_money CHECK ("pricePerShare">=0 AND "pricePerShare"<=99999999999999999999.99999999 AND currency IN ('NGN','USD','GBP','EUR'));
ALTER TABLE valuation_snapshots ADD CONSTRAINT valuation_evidence CHECK (length(trim(methodology))>=10 AND length(trim("sourceReference"))>=3 AND "asOf">='1900-01-01');
ALTER TABLE announcements ADD CONSTRAINT announcement_evidence CHECK (length(trim(title))>=3 AND length(trim(body))>=3 AND length(trim("sourceReference"))>=3 AND "datedAt">='1900-01-01');
ALTER TABLE dividend_records ADD CONSTRAINT dividend_money CHECK (amount>0 AND amount<=99999999999999999999.99999999 AND currency IN ('NGN','USD','GBP','EUR'));
ALTER TABLE dividend_records ADD CONSTRAINT dividend_parent CHECK ((status='DECLARED' AND "declarationId" IS NULL) OR (status='PAID' AND "declarationId" IS NOT NULL));
ALTER TABLE dividend_records ADD CONSTRAINT dividend_evidence CHECK (length(trim(reference))>=3 AND "datedAt">='1900-01-01');
CREATE FUNCTION guard_reporting_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reporting records are retained; withdraw instead' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."publishedAt" IS NOT NULL OR NEW."withdrawnAt" IS NOT NULL THEN RAISE EXCEPTION 'Create reports as drafts' USING ERRCODE='23514'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'publishedAt'-'withdrawnAt') IS DISTINCT FROM (to_jsonb(OLD)-'publishedAt'-'withdrawnAt') THEN RAISE EXCEPTION 'Source records are immutable; withdraw and replace' USING ERRCODE='23514'; END IF;
  IF OLD."withdrawnAt" IS NOT NULL THEN RAISE EXCEPTION 'Withdrawn reports cannot change' USING ERRCODE='23514'; END IF;
  IF NOT ((OLD."publishedAt" IS NULL AND NEW."publishedAt" IS NOT NULL AND NEW."withdrawnAt" IS NULL) OR (NEW."publishedAt" IS NOT DISTINCT FROM OLD."publishedAt" AND NEW."withdrawnAt" IS NOT NULL)) THEN RAISE EXCEPTION 'Invalid publication transition' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW."publishedAt">clock_timestamp()+interval '5 seconds' OR NEW."withdrawnAt">clock_timestamp()+interval '5 seconds' THEN RAISE EXCEPTION 'Publication cannot be scheduled' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION validate_reporting_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='valuation_snapshots' THEN
  IF NEW."asOf">CURRENT_DATE THEN RAISE EXCEPTION 'Future valuation date' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW."datedAt">CURRENT_DATE THEN RAISE EXCEPTION 'Future reporting date' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER announcement_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON announcements FOR EACH ROW EXECUTE FUNCTION guard_reporting_lifecycle();
CREATE TRIGGER valuation_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON valuation_snapshots FOR EACH ROW EXECUTE FUNCTION guard_reporting_lifecycle();
CREATE TRIGGER dividend_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON dividend_records FOR EACH ROW EXECUTE FUNCTION guard_reporting_lifecycle();
CREATE TRIGGER announcement_dates BEFORE INSERT ON announcements FOR EACH ROW EXECUTE FUNCTION validate_reporting_date();
CREATE TRIGGER valuation_dates BEFORE INSERT ON valuation_snapshots FOR EACH ROW EXECUTE FUNCTION validate_reporting_date();
CREATE TRIGGER dividend_dates BEFORE INSERT ON dividend_records FOR EACH ROW EXECUTE FUNCTION validate_reporting_date();
CREATE TRIGGER announcement_retain BEFORE TRUNCATE ON announcements FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER valuation_retain BEFORE TRUNCATE ON valuation_snapshots FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER dividend_retain BEFORE TRUNCATE ON dividend_records FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
CREATE FUNCTION guard_dividend_register() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent dividend_records%ROWTYPE;
BEGIN
 IF TG_OP='INSERT' AND NEW.status='DECLARED' THEN
  IF NOT EXISTS(SELECT 1 FROM shareholdings h JOIN shareholders s ON s.id=h."shareholderId" WHERE h."shareholderId"=NEW."shareholderId" AND h."shareClassId"=NEW."shareClassId" AND h."verifiedAt" IS NOT NULL AND s."verificationReference" IS NOT NULL) THEN RAISE EXCEPTION 'Verified historical holding required' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='PAID' THEN
  SELECT * INTO parent FROM dividend_records WHERE id=NEW."declarationId" FOR UPDATE;
  IF NOT FOUND OR parent.status<>'DECLARED' OR parent."publishedAt" IS NULL OR parent."withdrawnAt" IS NOT NULL OR parent."shareholderId"<>NEW."shareholderId" OR parent."shareClassId"<>NEW."shareClassId" OR parent.currency<>NEW.currency OR NEW."datedAt"<parent."datedAt" THEN RAISE EXCEPTION 'Invalid payment declaration or date' USING ERRCODE='23514'; END IF;
  IF NEW."withdrawnAt" IS NULL AND (SELECT COALESCE(SUM(amount),0) FROM dividend_records WHERE "declarationId"=parent.id AND "withdrawnAt" IS NULL AND id<>NEW.id)+NEW.amount>parent.amount THEN RAISE EXCEPTION 'Payment records exceed declaration' USING ERRCODE='23514'; END IF;
 ELSIF TG_OP='UPDATE' AND NEW."withdrawnAt" IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM dividend_records WHERE "declarationId"=NEW.id AND "withdrawnAt" IS NULL) THEN RAISE EXCEPTION 'Withdraw linked payments before their declaration' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dividend_register BEFORE INSERT OR UPDATE ON dividend_records FOR EACH ROW EXECUTE FUNCTION guard_dividend_register();
COMMIT;
