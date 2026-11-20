-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SHAREHOLDER');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_classes" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issuedShares" BIGINT NOT NULL,

    CONSTRAINT "share_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "Role" NOT NULL DEFAULT 'SHAREHOLDER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inviteHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "legalName" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "shareholders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shareholdings" (
    "id" UUID NOT NULL,
    "shareholderId" UUID NOT NULL,
    "shareClassId" UUID NOT NULL,
    "quantity" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shareholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "share_classes_companyId_name_key" ON "share_classes"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_inviteHash_key" ON "users"("inviteHash");

-- CreateIndex
CREATE UNIQUE INDEX "shareholders_userId_key" ON "shareholders"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "shareholdings_shareholderId_shareClassId_key" ON "shareholdings"("shareholderId", "shareClassId");

-- AddForeignKey
ALTER TABLE "share_classes" ADD CONSTRAINT "share_classes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholders" ADD CONSTRAINT "shareholders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_shareholderId_fkey" FOREIGN KEY ("shareholderId") REFERENCES "shareholders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholdings" ADD CONSTRAINT "shareholdings_shareClassId_fkey" FOREIGN KEY ("shareClassId") REFERENCES "share_classes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Exact whole shares only. MySQL equivalents: BIGINT and CHECK constraints.
ALTER TABLE "share_classes" ADD CONSTRAINT "issued_shares_nonnegative" CHECK ("issuedShares" >= 0);
ALTER TABLE "shareholdings" ADD CONSTRAINT "quantity_nonnegative" CHECK ("quantity" >= 0);
-- Session format required by connect-pg-simple; no financial data belongs here.
CREATE TABLE "sessions" (
 "sid" varchar NOT NULL PRIMARY KEY,
 "sess" json NOT NULL,
 "expire" timestamp(6) NOT NULL
);
CREATE INDEX "sessions_expire_idx" ON "sessions" ("expire");
-- Audit records are append-only even if future application code attempts edits.
CREATE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs are append-only'; END;
$$;
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
