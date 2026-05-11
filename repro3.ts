import { Agent, type Run as SDKRun } from "@cursor/sdk";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

async function main() {
  let apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    try {
      const authPath = path.join(os.homedir(), ".local", "share", "opencode", "auth.json");
      const authData = JSON.parse(fs.readFileSync(authPath, "utf8"));
      apiKey = authData.cursor.key || authData.cursor.access;
    } catch (e) {
      console.error("Could not find api key");
      return;
    }
  }

  try {
    console.log("Creating agent with NO cloud opts (Local Mode)...");
    const agent = await Agent.create({ 
      apiKey, 
      model: { id: "composer-2" }
    });
    
    console.log("Sending message...");
    const run = await agent.send("What is 1+1? Answer briefly.");
    const result = await (run as SDKRun).wait();
    
    console.log("SUCCESS!", result.status);
    console.log("Result:", result.result);
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    console.log(`FAILED: [${errObj.name}] ${err instanceof Error ? err.message : String(err)}`);
  }
}

void main().catch(console.error);
