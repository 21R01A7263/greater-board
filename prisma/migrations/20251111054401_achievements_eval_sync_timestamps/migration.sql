-- AlterTable
ALTER TABLE "User" ADD COLUMN     "achievementsLastEvaluatedAt" TIMESTAMP(3),
ADD COLUMN     "aggregatesLastSyncedAt" TIMESTAMP(3);
