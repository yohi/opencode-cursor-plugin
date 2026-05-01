import { describe, expect, it } from "vitest";
import { promptSchema, modelSchema } from "../.opencode/plugins/custom-tools";

describe("Zod Schema Validation (from Implementation)", () => {
  describe("prompt schema", () => {
    it("accepts valid strings", () => {
      expect(promptSchema.parse("hello")).toBe("hello");
      expect(promptSchema.parse("  hello  ")).toBe("hello");
    });

    it("rejects empty strings", () => {
      expect(() => promptSchema.parse("")).toThrow();
    });

    it("rejects whitespace-only strings", () => {
      expect(() => promptSchema.parse("   ")).toThrow();
      expect(() => promptSchema.parse("\n\t ")).toThrow();
    });
  });

  describe("model schema", () => {
    it("accepts valid strings", () => {
      expect(modelSchema.parse("gpt-4")).toBe("gpt-4");
      expect(modelSchema.parse("  claude-3  ")).toBe("claude-3");
    });

    it("accepts undefined", () => {
      expect(modelSchema.parse(undefined)).toBeUndefined();
    });

    it("rejects empty strings", () => {
      expect(() => modelSchema.parse("")).toThrow();
    });

    it("rejects whitespace-only strings", () => {
      expect(() => modelSchema.parse("   ")).toThrow();
    });
  });
});
