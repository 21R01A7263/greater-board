-- Migration: add repoEtag, commitsEtag to Repository; add userId to Commit and supporting index
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "repoEtag" TEXT;
ALTER TABLE "Repository" ADD COLUMN IF NOT EXISTS "commitsEtag" TEXT;
ALTER TABLE "Commit" ADD COLUMN IF NOT EXISTS "userId" TEXT;
-- Backfill userId on existing commits by joining Repository
UPDATE "Commit" c SET "userId" = r."userId" FROM "Repository" r WHERE c."repositoryId" = r."id" AND c."userId" IS NULL;
-- Create index for userId + authorDate
CREATE INDEX IF NOT EXISTS "Commit_userId_authorDate_idx" ON "Commit"("userId", "authorDate");