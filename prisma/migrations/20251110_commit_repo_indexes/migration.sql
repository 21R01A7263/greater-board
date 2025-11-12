-- Composite index to support filtered queries and ordering by date
CREATE INDEX IF NOT EXISTS "Commit_repositoryId_authorDate_idx" ON "public"."Commit"("repositoryId", "authorDate");

-- Index to accelerate filtering repositories by user
CREATE INDEX IF NOT EXISTS "Repository_userId_idx" ON "public"."Repository"("userId");
