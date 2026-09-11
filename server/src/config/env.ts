import dotenv from "dotenv";
import path from "path";

// Load .env from server or root
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const MIN_JWT_SECRET_LENGTH = 32;

const WEAK_SECRETS = new Set([
  "change-me-in-production-use-a-long-random-secret",
  "replace-with-a-long-random-secret-at-least-32-chars",
  "your-long-random-secret",
  "jwt_secret",
  "secret",
  "meetspace",
]);

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("JWT_SECRET is not set. Set a secure secret of at least 32 characters in .env.");
    }
    return "dev_secret_meetspace_minimum_32_characters_long_for_auth";
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`);
  }
  if (process.env.NODE_ENV === "production" && WEAK_SECRETS.has(secret.toLowerCase())) {
    throw new Error("JWT_SECRET is a known placeholder. Provide a strong production secret.");
  }
  return secret;
}

export const config = {
  port: parseInt(process.env.PORT || "5000", 10),
  clientUrl: (process.env.CLIENT_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:5173").replace(/\/$/, ""),
  jwtSecret: getJwtSecret(),
  pistonUrl: process.env.PISTON_URL || "https://emkc.org/api/v2/piston/execute",
  interviewerInviteCode: process.env.INTERVIEWER_INVITE_CODE || "",
  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY || "",
    apiSecret: process.env.LIVEKIT_API_SECRET || "",
    url: process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || "",
  },
  webrtc: {
    stunUrls: (process.env.STUN_URLS || "stun:stun.l.google.com:19302").split(",").map(s => s.trim()).filter(Boolean),
    turnUrls: (process.env.TURN_URLS || "").split(",").map(s => s.trim()).filter(Boolean),
    turnUsername: process.env.TURN_USERNAME || "",
    turnCredential: process.env.TURN_CREDENTIAL || "",
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  },

    groq: {
    apiKey: process.env.GROQ_API_KEY || "",
    model: process.env.GROQ_MODEL || "qwen/qwen3.6-27b",
  },
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "no-reply@meetspace.com",
  },
  backblaze: {
    bucketName: process.env.B2_BUCKET_NAME || "",
    endpoint: process.env.B2_ENDPOINT || "",
    region: process.env.B2_REGION || "",
    accessKeyId: process.env.B2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.B2_SECRET_ACCESS_KEY || "",
  },
  assemblyai: {
    apiKey: process.env.ASSEMBLYAI_API_KEY || "",
  },
};

// Fail fast in production if a service that's actually used has partial/missing config.
if (process.env.NODE_ENV === "production") {
  const missing: string[] = [];

  const livekitPartial =
    (config.livekit.apiKey || config.livekit.apiSecret || config.livekit.url) &&
    !(config.livekit.apiKey && config.livekit.apiSecret && config.livekit.url);
  if (livekitPartial) missing.push("LIVEKIT_API_KEY / LIVEKIT_API_SECRET / LIVEKIT_URL (set all three or none)");

  const smtpPartial =
    (config.smtp.host || config.smtp.user) && !(config.smtp.host && config.smtp.user && config.smtp.pass);
  if (smtpPartial) missing.push("SMTP_HOST / SMTP_USER / SMTP_PASS (set all three or none)");

  const backblazePartial =
    (config.backblaze.bucketName || config.backblaze.accessKeyId) &&
    !(config.backblaze.bucketName && config.backblaze.endpoint && config.backblaze.region && config.backblaze.accessKeyId && config.backblaze.secretAccessKey);
  if (backblazePartial) missing.push("B2_BUCKET_NAME / B2_ENDPOINT / B2_REGION / B2_ACCESS_KEY_ID / B2_SECRET_ACCESS_KEY (set all five or none)");

  if (config.pistonUrl.includes("emkc.org")) {
    console.warn(
      "[WARNING] Using the public Piston API (emkc.org) in production. " +
      "This is a shared, rate-limited free service — self-host Piston before relying on it for real users."
    );
  }

  if (missing.length > 0) {
    throw new Error(`Incomplete environment configuration in production:\n- ${missing.join("\n- ")}`);
  }
}