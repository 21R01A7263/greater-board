-- CreateTable
CREATE TABLE "UserScore" (
    "userId" TEXT NOT NULL,
    "current" INTEGER NOT NULL DEFAULT 700,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserScore_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "UserDailyScore" (
    "id" SERIAL NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "gain" INTEGER NOT NULL,
    "loss" INTEGER NOT NULL,
    "net" INTEGER NOT NULL,
    "streakLength" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDailyScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardSnapshot" (
    "id" SERIAL NOT NULL,
    "period" TEXT NOT NULL,
    "referenceDate" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDailyScore_date_idx" ON "UserDailyScore"("date");

-- CreateIndex
CREATE INDEX "UserDailyScore_userId_date_idx" ON "UserDailyScore"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UserDailyScore_userId_date_key" ON "UserDailyScore"("userId", "date");

-- CreateIndex
CREATE INDEX "LeaderboardSnapshot_period_referenceDate_idx" ON "LeaderboardSnapshot"("period", "referenceDate");

-- AddForeignKey
ALTER TABLE "UserScore" ADD CONSTRAINT "UserScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDailyScore" ADD CONSTRAINT "UserDailyScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
