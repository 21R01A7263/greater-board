/*
  Warnings:

  - You are about to drop the column `lastCommitIDTracked` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "lastCommitIDTracked",
ADD COLUMN     "avatarURL" TEXT;
