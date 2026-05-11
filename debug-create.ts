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
    { name: "With auto-detected URL", opts: { apiKey, model: { id: "composer-2" }, cloud: { repos: [{ url: repoUrl }] } } },
    { name: "Without repos array", opts: { apiKey, model: { id: "composer-2" }, cloud: {} } },
    { name: "With empty repos array", opts: { apiKey, model: { id: "composer-2" }, cloud: { repos: [] } } }
  ];

  for (const tc of optsList) {
    console.log(`\n=== Testing: ${tc.name} ===`);
    console.log("Payload:", JSON.stringify(tc.opts.cloud, null, 2));
    try {
      await Agent.create(tc.opts);
      console.log("SUCCESS");
    } catch (err: any) {
      console.log("FAILED");
      console.log("Name:", err.name);
      console.log("Message:", err.message);
      console.log("Code:", err.code);
      if (err.details) console.log("Details:", JSON.stringify(err.details, null, 2));
      
      // Dump all enumerable properties
      console.log("Full Object Dump:");
      for (const key in err) {
        console.log(`  ${key}:`, err[key]);
      }
    }
  }
}

main().catch(console.error);