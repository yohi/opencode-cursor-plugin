import { Agent } from "@cursor/sdk";

async function test(name: string, opts: any) {
  try {
    console.log(`\n--- Testing: ${name} ---`);
    const agent = await Agent.create(opts);
    const run = await agent.send("hello");
    const result = await (run as any).wait();
    console.log("SUCCESS!", result.status);
  } catch (err: any) {
    console.log(`FAILED: [${err.name}] ${err.message}`);
  }
}

async function main() {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    console.log("Skipping tests because CURSOR_API_KEY is not set.");
    return;
  }
  const modelId = "composer-2";

  await test("Empty cloud opts", { 
    apiKey, 
    model: { id: modelId }, 
    cloud: {} 
  });

  await test("With valid-looking repo URL", { 
    apiKey, 
    model: { id: modelId }, 
    cloud: { repos: [{ url: "https://github.com/microsoft/vscode" }] } 
  });
}

main();