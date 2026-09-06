import { S3Client, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config/env";
import { prisma } from "../lib/prisma";
import { generateMinuteSnapshots } from "./minute-snapshot.service";

function getS3Client(): S3Client {
  return new S3Client({
    endpoint: `https://${config.backblaze.endpoint}`,
    region: config.backblaze.region,
    credentials: {
      accessKeyId: config.backblaze.accessKeyId,
      secretAccessKey: config.backblaze.secretAccessKey,
    },
  });
}

// Backblaze upload finishes asynchronously after Egress stops recording;
// poll until the object actually exists before handing a link to AssemblyAI.
async function waitForRecordingFile(
  key: string,
  maxAttempts: number = 20,
  delayMs: number = 15000
): Promise<boolean> {
  const s3 = getS3Client();
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: config.backblaze.bucketName, Key: key }));
      console.log(`Recording file found: ${head.ContentLength} bytes`);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

async function getSignedRecordingUrl(key: string): Promise<string> {
  const s3 = getS3Client();
  const command = new GetObjectCommand({ Bucket: config.backblaze.bucketName, Key: key });
  return getSignedUrl(s3, command, { expiresIn: 3600 }); // 1 hour, plenty for AssemblyAI to fetch it
}

interface AssemblyAiUtterance {
  speaker: string;
  text: string;
  start: number; // ms
  end: number; // ms
}

async function submitToAssemblyAi(audioUrl: string): Promise<string> {
  const res = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      Authorization: config.assemblyai.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true, // this is what separates interviewer vs candidate speech
    }),
  });
  const data = (await res.json()) as { id?: string; error?: string };
  if (!res.ok) throw new Error(`AssemblyAI submission failed: ${JSON.stringify(data)}`);
  return data.id as string;
}

async function pollAssemblyAiResult(
  transcriptId: string,
  maxAttempts: number = 40,
  delayMs: number = 15000
): Promise<{ utterances: AssemblyAiUtterance[] } | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { Authorization: config.assemblyai.apiKey },
    });
    const data = (await res.json()) as {
      status?: string;
      utterances?: AssemblyAiUtterance[];
      error?: string;
    };

    if (data.status === "completed") {
      return { utterances: data.utterances ?? [] };
    }
    if (data.status === "error") {
      console.error(`AssemblyAI transcription failed: ${data.error}`);
      return null;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export async function processInterviewTranscript(interviewId: string): Promise<void> {
  if (!config.assemblyai.apiKey) {
    console.log("AssemblyAI not configured, skipping transcription");
    return;
  }

    const recordingKey = `recordings/interview-${interviewId}.mp4`;
  

  console.log(`Waiting for recording upload to finish for interview ${interviewId}...`);
  const fileReady = await waitForRecordingFile(recordingKey);
  if (!fileReady) {
    console.error(`Recording file never appeared for interview ${interviewId}, skipping transcription`);
    return;
  }

  const signedUrl = await getSignedRecordingUrl(recordingKey);

  console.log(`Submitting interview ${interviewId} recording to AssemblyAI...`);
  const transcriptId = await submitToAssemblyAi(signedUrl);

  console.log(`Polling AssemblyAI for interview ${interviewId} transcript...`);
  const result = await pollAssemblyAiResult(transcriptId);
  if (!result) {
    console.error(`Transcription did not complete for interview ${interviewId}`);
    return;
  }

  console.log(`Saving ${result.utterances.length} transcript segments for interview ${interviewId}...`);
  for (const utterance of result.utterances) {
    await prisma.interviewEvent.create({
      data: {
        interviewId,
        type: "TRANSCRIPT",
        timestampMs: utterance.start,
        payload: {
          speaker: utterance.speaker,
          text: utterance.text,
          endMs: utterance.end,
        },
      },
    });
  }

  console.log(`Transcription complete for interview ${interviewId}`);

  console.log(`Generating minute snapshots for interview ${interviewId}...`);
  try {
    await generateMinuteSnapshots(interviewId);
  } catch (err) {
    console.error(`Failed to generate minute snapshots for interview ${interviewId}:`, err);
  }
}