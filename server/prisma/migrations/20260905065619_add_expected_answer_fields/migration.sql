/*
  Warnings:

  - Made the column `timeSpentSecs` on table `InterviewQuestion` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "InterviewQuestion" ALTER COLUMN "timeSpentSecs" SET NOT NULL,
ALTER COLUMN "timeSpentSecs" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Question" ADD COLUMN     "expectedApproach" TEXT,
ADD COLUMN     "expectedSpaceComplexity" TEXT,
ADD COLUMN     "expectedTimeComplexity" TEXT;
