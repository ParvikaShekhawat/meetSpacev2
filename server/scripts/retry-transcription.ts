import { processInterviewTranscript } from "../src/services/transcription.service";

const interviewId = process.argv[2];
if (!interviewId) {
  console.error("Usage: npx tsx scripts/retry-transcription.ts <interviewId>");
  process.exit(1);
}

processInterviewTranscript(interviewId)
  .then(() => {
    
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  });