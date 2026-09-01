import { AccessToken } from "livekit-server-sdk";
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