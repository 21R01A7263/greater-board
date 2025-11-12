-- AlterTable
ALTER TABLE "User" ADD COLUMN     "timezone" TEXT;

-- CreateTable
CREATE TABLE "RepoDailyContribution" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "githubRepoId" INTEGER NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "isPrivate" BOOLEAN NOT NULL DEFAULT false,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoDailyContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionTimeBucket" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "morningCount" INTEGER NOT NULL DEFAULT 0,
    "eveningCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionTimeBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RepoDailyContribution_userId_date_idx" ON "RepoDailyContribution"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RepoDailyContribution_userId_date_githubRepoId_key" ON "RepoDailyContribution"("userId", "date", "githubRepoId");

-- CreateIndex
CREATE INDEX "ContributionTimeBucket_userId_date_idx" ON "ContributionTimeBucket"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionTimeBucket_userId_date_key" ON "ContributionTimeBucket"("userId", "date");

-- AddForeignKey
ALTER TABLE "RepoDailyContribution" ADD CONSTRAINT "RepoDailyContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionTimeBucket" ADD CONSTRAINT "ContributionTimeBucket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
