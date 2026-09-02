import crypto from "crypto";

export function generateTemporaryPassword(): string {
  return "Temp@" + crypto.randomBytes(9).toString("hex");
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function getVerificationTokenExpiry(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
}