import { prisma } from "../lib/prisma";
import { Prisma } from "@prisma/client";

const MS_PER_MINUTE = 60000;

export async function generateMinuteSnapshots(interviewId: string): Promise<void> {
  const events = await prisma.interviewEvent.findMany({
    where: { interviewId },
    orderBy: { timestampMs: "asc" },
  });

  if (events.length === 0) {
    console.log(`No events found for interview ${interviewId}, skipping minute snapshots`);
    return;
  }

  const lastTimestamp = events[events.length - 1].timestampMs;
  const totalMinutes = Math.ceil(lastTimestamp / MS_PER_MINUTE) + 1;

  // These carry forward across minutes with no new activity — code and the
  // active question don't reset just because nothing happened in a given minute.
  let latestCode: string | null = null;
  let activeQuestionId: string | null = null;

  for (let minute = 0; minute < totalMinutes; minute++) {
    const rangeStart = minute * MS_PER_MINUTE;
    const rangeEnd = rangeStart + MS_PER_MINUTE;

    const eventsInMinute = events.filter(
      (e) => e.timestampMs >= rangeStart && e.timestampMs < rangeEnd
    );

    const transcriptParts: string[] = [];
    const flagsInMinute: Record<string, unknown>[] = [];

    for (const event of eventsInMinute) {
      const payload = event.payload as Record<string, unknown>;

      if (event.type === "TRANSCRIPT" && typeof payload.text === "string") {
        transcriptParts.push(payload.text);
      }

      if (event.type === "FLAG") {
        flagsInMinute.push({ flagType: event.flagType, ...payload });
      }

      if (event.type === "CODE_CHANGE" && typeof payload.code === "string") {
        latestCode = payload.code;
      }

      if (event.questionId) {
        activeQuestionId = event.questionId;
      }
    }

    // Skip only if there's truly nothing to show yet (e.g. before the interview
    // has even started its first question) — otherwise still record the minute
    // so the timeline has no gaps once activity has begun.
    if (transcriptParts.length === 0 && flagsInMinute.length === 0 && !latestCode && !activeQuestionId) {
      continue;
    }

    await prisma.minuteSnapshot.upsert({
      where: { interviewId_minuteNumber: { interviewId, minuteNumber: minute } },
      create: {
        interviewId,
        minuteNumber: minute,
        transcriptText: transcriptParts.length > 0 ? transcriptParts.join(" ") : null,
        codeSnapshot: latestCode,
        questionId: activeQuestionId,
        flags: flagsInMinute.length > 0 ? (flagsInMinute as Prisma.InputJsonValue) : undefined,
      },
      update: {
        transcriptText: transcriptParts.length > 0 ? transcriptParts.join(" ") : null,
        codeSnapshot: latestCode,
        questionId: activeQuestionId,
        flags: flagsInMinute.length > 0 ? (flagsInMinute as Prisma.InputJsonValue) : undefined,
      },
    });
  }

 console.log(`Generated minute snapshots for interview ${interviewId}`);
}