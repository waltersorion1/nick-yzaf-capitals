BEGIN;
-- CreateTable
CREATE TABLE "opening_import_batches" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "contentHash" VARCHAR(64) NOT NULL,
    "csvText" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "preview" JSONB NOT NULL,
    "previewDigest" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "committedAt" TIMESTAMP(3),
    "commitRequestId" UUID,
    "receipt" JSONB,

    CONSTRAINT "opening_import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "opening_import_batches_actorId_createdAt_idx" ON "opening_import_batches"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "opening_import_batches" ADD CONSTRAINT "opening_import_batches_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX opening_import_committed_hash ON opening_import_batches("contentHash") WHERE "committedAt" IS NOT NULL;
ALTER TABLE opening_import_batches ADD CONSTRAINT import_hash_format CHECK ("contentHash" ~ '^[0-9a-f]{64}$' AND "previewDigest" ~ '^[0-9a-f]{64}$');
ALTER TABLE opening_import_batches ADD CONSTRAINT import_evidence CHECK (length(trim(reason))>=3 AND octet_length("csvText")<=131072 AND "expiresAt">"createdAt");
ALTER TABLE opening_import_batches ADD CONSTRAINT import_receipt CHECK (("committedAt" IS NULL AND "commitRequestId" IS NULL AND receipt IS NULL) OR ("committedAt" IS NOT NULL AND "commitRequestId" IS NOT NULL AND receipt IS NOT NULL));
CREATE FUNCTION guard_opening_import() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Import evidence is retained' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW."committedAt" IS NOT NULL THEN RAISE EXCEPTION 'Create an import preview before committing' USING ERRCODE='23514'; END IF;
 ELSE
  IF OLD."committedAt" IS NOT NULL OR (to_jsonb(NEW)-'committedAt'-'commitRequestId'-'receipt') IS DISTINCT FROM (to_jsonb(OLD)-'committedAt'-'commitRequestId'-'receipt') THEN RAISE EXCEPTION 'Import evidence is immutable' USING ERRCODE='23514'; END IF;
  IF NEW."committedAt" IS NULL OR NEW."committedAt">OLD."expiresAt" THEN RAISE EXCEPTION 'Invalid or expired import commit' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER import_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON opening_import_batches FOR EACH ROW EXECUTE FUNCTION guard_opening_import();
CREATE TRIGGER import_evidence_no_truncate BEFORE TRUNCATE ON opening_import_batches FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_mutation();
COMMIT;
