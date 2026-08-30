import { prisma } from "./prisma";

export async function generateInterviewCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const num = Math.floor(1000 + Math.random() * 9000);
    const code = `INT-${num}`;

    const existing = await prisma.interview.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate a unique interview code after 5 attempts");
}