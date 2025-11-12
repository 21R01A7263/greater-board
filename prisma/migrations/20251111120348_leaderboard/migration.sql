-- CreateTable
CREATE TABLE "UserDayCommitAggregate" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "shortMsgs" INTEGER NOT NULL DEFAULT 0,
    "conventional" INTEGER NOT NULL DEFAULT 0,
    "fixRefactorTest" INTEGER NOT NULL DEFAULT 0,
    "uniqueMessages" INTEGER NOT NULL DEFAULT 0,
    "hoursJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserDayCommitAggregate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserDayCommitAggregate_date_idx" ON "UserDayCommitAggregate"("date");

-- CreateIndex
CREATE UNIQUE INDEX "UserDayCommitAggregate_userId_date_key" ON "UserDayCommitAggregate"("userId", "date");

-- AddForeignKey
ALTER TABLE "UserDayCommitAggregate" ADD CONSTRAINT "UserDayCommitAggregate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
