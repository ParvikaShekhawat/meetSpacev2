import { generateMinuteSnapshots } from "../src/services/minute-snapshot.service";

const interviewId = process.argv[2];
if (!interviewId) {
  console.error("Usage: npx tsx scripts/test-minute-snapshots.ts <interviewId>");
  process.exit(1);
}

generateMinuteSnapshots(interviewId)
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });