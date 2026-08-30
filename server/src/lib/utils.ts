import crypto from "crypto";

export function generateTemporaryPassword(): string {
  return "Temp@" + crypto.randomBytes(9).toString("hex");
}