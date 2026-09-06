import { prisma } from "../src/lib/prisma";

const interviewId = process.argv[2];
if (!interviewId) {
  console.error("Usage: npx tsx scripts/seed-fake-events.ts <interviewId>");
  process.exit(1);
}

async function main() {
  const interview = await prisma.interview.findUnique({
    where: { id: interviewId },
    include: { questions: true },
  });
  if (!interview) throw new Error("Interview not found");
  const questionId = interview.questions[0]?.questionId;
  if (!questionId) throw new Error("Interview has no questions attached");

  // Minute 0: some talking
  await prisma.interviewEvent.create({
    data: {
      interviewId,
      type: "TRANSCRIPT",
      timestampMs: 5000,
      questionId,
      payload: { speaker: "A", text: "Let's start with the two sum problem.", endMs: 8000 },
    },
  });

  // Minute 1: candidate writes code
  await prisma.interviewEvent.create({
    data: {
      interviewId,
      type: "CODE_CHANGE",
      timestampMs: 70000, // 1 min 10 sec
      questionId,
      payload: { code: "function twoSum(nums, target) { }", language: "javascript" },
    },
  });

  // Minute 1: also some talking
  await prisma.interviewEvent.create({
    data: {
      interviewId,
      type: "TRANSCRIPT",
      timestampMs: 75000,
      questionId,
      payload: { speaker: "B", text: "I think I can use a hashmap here.", endMs: 78000 },
    },
  });

  // Minute 3: a flag (minute 2 has NO events at all — tests carry-forward)
  await prisma.interviewEvent.create({
    data: {
      interviewId,
      type: "FLAG",
      flagType: "GOOD_INSIGHT",
      timestampMs: 190000, // 3 min 10 sec
      questionId,
      payload: { userId: "test", note: "Good hashmap insight" },
    },
  });

  console.log("Fake events seeded. Minutes 0, 1, and 3 have direct events; minute 2 should carry forward code/question from minute 1.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });