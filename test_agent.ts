import { Agent } from "@cursor/sdk";

async function main() {
  try {
    const agent = await Agent.create({
      apiKey: "test-api-key",
      model: { id: "composer-2" },
      local: { cwd: process.cwd() }
    });
    console.log("Agent created successfully!");
  } catch (err) {
    console.error("Error creating agent:", err);
  }
}

main();
