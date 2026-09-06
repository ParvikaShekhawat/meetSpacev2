-- CreateTable
CREATE TABLE "MinuteSnapshot" (
    "id" TEXT NOT NULL,
    "interviewId" TEXT NOT NULL,
    "minuteNumber" INTEGER NOT NULL,
    "transcriptText" TEXT,
    "codeSnapshot" TEXT,
    "questionId" TEXT,
    "flags" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MinuteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MinuteSnapshot_interviewId_idx" ON "MinuteSnapshot"("interviewId");

-- CreateIndex
CREATE UNIQUE INDEX "MinuteSnapshot_interviewId_minuteNumber_key" ON "MinuteSnapshot"("interviewId", "minuteNumber");

-- AddForeignKey
ALTER TABLE "MinuteSnapshot" ADD CONSTRAINT "MinuteSnapshot_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES "Interview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
