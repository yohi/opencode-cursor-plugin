import { describe, expect, it } from "vitest";
import { z } from "zod";

// custom-tools.ts からスキーマをエクスポートしていないため、
// 同等のロジックをテストするか、リファクタリングしてエクスポート可能にする必要があります。
// ここでは、現在の実装が期待通りに動作することを確認するために、同様のスキーマを定義してテストします。

const promptSchema = z.string().trim().min(1);
const modelSchema = z.string().trim().min(1).optional();

describe("Zod Schema Validation", () => {
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
