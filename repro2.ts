import { Agent } from "@cursor/sdk";
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
    console.log("Creating agent with empty cloud opts...");
    const agent = await Agent.create({ 
      apiKey, 
      model: { id: "composer-2" }, 
      cloud: {} 
    });
    
    console.log("Sending message...");
    const run = await agent.send("What is 1+1? Answer briefly.");
    const result = await (run as any).wait();
    
    console.log("SUCCESS!", result.status);
    console.log("Result:", result.result);
  } catch (err: any) {
    console.log(`FAILED: [${err.name}] ${err.message}`);
  }
}

main();