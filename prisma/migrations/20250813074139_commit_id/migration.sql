/*
  Warnings:

  - You are about to drop the column `sha` on the `Commit` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[commit_id]` on the table `Commit` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `commit_id` to the `Commit` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "public"."Commit_sha_key";

-- AlterTable
ALTER TABLE "public"."Commit" DROP COLUMN "sha",
ADD COLUMN     "commit_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "commitIDTracked" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Commit_commit_id_key" ON "public"."Commit"("commit_id");
