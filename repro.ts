import { Agent, type Run as SDKRun } from "@cursor/sdk";

async function test(name: string, opts: Record<string, unknown>) {
  try {
    console.log(`\n--- Testing: ${name} ---`);
    const agent = await Agent.create(opts as any);
    const run = await agent.send("hello");
    const result = await (run as SDKRun).wait();
    console.log("SUCCESS!", result.status);
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    console.log(`FAILED: [${errObj.name}] ${err instanceof Error ? err.message : String(err)}`);
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

void main().catch(console.error);
