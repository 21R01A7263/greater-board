-- Create an index to speed up queries and purges by authorDate
CREATE INDEX IF NOT EXISTS "Commit_authorDate_idx" ON "public"."Commit"("authorDate");
