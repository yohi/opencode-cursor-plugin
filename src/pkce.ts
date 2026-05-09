import { createHash, randomBytes } from "node:crypto";

export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return { verifier, challenge };
}
