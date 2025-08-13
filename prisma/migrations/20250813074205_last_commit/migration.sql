/*
  Warnings:

  - You are about to drop the column `commitIDTracked` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "public"."User" DROP COLUMN "commitIDTracked",
ADD COLUMN     "lastCommitIDTracked" TEXT;
