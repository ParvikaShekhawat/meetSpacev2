import { AccessToken, EgressClient, EncodedFileType, EncodedFileOutput, S3Upload } from "livekit-server-sdk";
import { config } from "../config/env";

export function isLiveKitConfigured(): boolean {
  return !!(
    config.livekit.apiKey &&
    config.livekit.apiSecret &&
    config.livekit.url
  );
}

export async function createLiveKitToken(
  roomName: string,
  participantName: string,
  participantIdentity: string
): Promise<string> {
  if (!isLiveKitConfigured()) {
    throw new Error("LiveKit is not configured");
  }

  const token = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity: participantIdentity,
    name: participantName,
    ttl: "2h",
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

export function getLiveKitUrl(): string | null {
  return config.livekit.url || null;
}

function getEgressClient(): EgressClient {
  if (!isLiveKitConfigured()) {
    throw new Error("LiveKit is not configured");
  }
  // EgressClient talks to LiveKit's REST API, not the media server directly,
  // so it needs the HTTP(S) URL — LiveKit accepts the same wss:// URL here too.
  return new EgressClient(config.livekit.url, config.livekit.apiKey, config.livekit.apiSecret);
}

export async function startRoomRecording(roomName: string): Promise<string> {
  const egressClient = getEgressClient();

  const fileOutput = new EncodedFileOutput({
    fileType: EncodedFileType.MP4,
    filepath: `recordings/${roomName}.mp4`,
    output: {
      case: "s3",
      value: new S3Upload({
        accessKey: config.backblaze.accessKeyId,
        secret: config.backblaze.secretAccessKey,
        bucket: config.backblaze.bucketName,
        region: config.backblaze.region,
        endpoint: `https://${config.backblaze.endpoint}`,
      }),
    },
  });

  const egressInfo = await egressClient.startRoomCompositeEgress(roomName, {
    file: fileOutput,
  });

  return egressInfo.egressId;
}

export async function stopRoomRecording(egressId: string): Promise<void> {
  const egressClient = getEgressClient();
  await egressClient.stopEgress(egressId);
}