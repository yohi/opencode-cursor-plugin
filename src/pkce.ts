import { createHash, randomBytes } from "node:crypto";

export async function generatePKCE(): Promise<{
	verifier: string;
	challenge: string;
}> {
	// 96 bytes random value as base64url (matches OSS implementation)
	const verifier = randomBytes(96)
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
