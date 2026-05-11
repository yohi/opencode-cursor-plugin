import { Agent } from "@cursor/sdk";
import { execSync } from "node:child_process";

async function main() {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.error("Please set CURSOR_API_KEY");
    process.exit(1);
  }

  let repoUrl;
  try {
    repoUrl = execSync("git remote get-url origin", { encoding: "utf8" }).trim();
    if (repoUrl.startsWith("git@")) {
      repoUrl = repoUrl.replace(":", "/").replace("git@", "https://").replace(/\.git$/, "");
    }
  } catch {}

  const optsList = [
    { name: "With specific URL", opts: { apiKey, model: { id: "composer-2" }, cloud: { repos: [{ url: "https://github.com/yohi/opencode-cursor-plugin" }] } } },
    { name: "Without repos array", opts: { apiKey, model: { id: "composer-2" }, cloud: {} } },
    { name: "With empty repos array", opts: { apiKey, model: { id: "composer-2" }, cloud: { repos: [] } } }
  ];

  if (repoUrl) {
    optsList.push({ name: "With auto-detected URL", opts: { apiKey, model: { id: "composer-2" }, cloud: { repos: [{ url: repoUrl }] } } });
  }

  for (const tc of optsList) {
    console.log(`\n=== Testing: ${tc.name} ===`);
    console.log("Payload:", JSON.stringify(tc.opts.cloud, null, 2));
    try {
      await Agent.create(tc.opts);
      console.log("SUCCESS");
    } catch (err: unknown) {
      const errObj = err as Record<string, unknown>;
      console.log("FAILED");
      console.log("Name:", errObj.name);
      console.log("Message:", err instanceof Error ? err.message : String(err));
      console.log("Code:", errObj.code);
      if (errObj.details) console.log("Details:", JSON.stringify(errObj.details, null, 2));
      
      // Dump whitelist of safe properties
      console.log("Error Details (Safe Dump):");
      const allowedKeys = ["message", "name", "code", "status", "stack"];
      for (const key of allowedKeys) {
        if (errObj[key] !== undefined) {
          console.log(`  ${key}:`, errObj[key]);
        }
      }
    }
  }
}

void main().catch(console.error);