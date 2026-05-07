import { describe, it, expect } from "vitest";
import { translate } from "./translator";

describe("translator", () => {
  it("should handle input_text part type", () => {
    const prompt = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "Hello" }
        ]
      }
    ] as any;
    const result = translate(prompt);
    expect(result.latestUserMessage).toBe("Hello");
  });

  it("should handle instructions from OpenCode", () => {
    const prompt = [
      { role: "system", content: "System instructions" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "User message" }
        ]
      }
    ] as any;
    const result = translate(prompt);
    expect(result.latestUserMessage).toBe("User message");
    expect(result.fullPromptOnMiss).toContain("System instructions");
    expect(result.fullPromptOnMiss).toContain("User message");
  });
});
