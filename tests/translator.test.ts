import { describe, expect, it } from "vitest";
import { translate, type LanguageModelV2Prompt } from "../.opencode/plugins/cursor-provider/translator";

const sys = (text: string) => ({ role: "system" as const, content: text });
const usr = (text: string) => ({ role: "user" as const, content: [{ type: "text" as const, text }] });
const asst = (text: string) => ({ role: "assistant" as const, content: [{ type: "text" as const, text }] });

describe("translate", () => {
  it("単一 user メッセージで prefixHash === hash([system]) を返す", () => {
    const prompt: LanguageModelV2Prompt = [sys("you are helpful"), usr("hi")];
    const result = translate(prompt);

    expect(result.latestUserMessage).toBe("hi");
    expect(result.prefixHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.nextHash).not.toBe(result.prefixHash);
  });

  it("ターン1 nextHash と ターン2 prefixHash が一致する（assistant 列フィルタ）", () => {
    const turn1: LanguageModelV2Prompt = [sys("S"), usr("U1")];
    const turn2: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1"), usr("U2")];
    const result1 = translate(turn1);
    const result2 = translate(turn2);

    expect(result2.prefixHash).toBe(result1.nextHash);
  });

  it("assistant 応答内容のみ違っても prefixHash/nextHash は同じ", () => {
    const a: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("RA"), usr("U2")];
    const b: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("RB"), usr("U2")];

    expect(translate(a).prefixHash).toBe(translate(b).prefixHash);
    expect(translate(a).nextHash).toBe(translate(b).nextHash);
  });

  it("user 履歴が分岐すると nextHash が異なる", () => {
    const a: LanguageModelV2Prompt = [sys("S"), usr("U1"), usr("U2")];
    const b: LanguageModelV2Prompt = [sys("S"), usr("U1"), usr("U2-alt")];

    expect(translate(a).nextHash).not.toBe(translate(b).nextHash);
  });

  it("末尾が user でない messages を例外で拒否", () => {
    const bad: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1")];
    expect(() => translate(bad)).toThrow(/last message must be user/i);
  });

  it("空 prompt を例外で拒否", () => {
    expect(() => translate([])).toThrow();
  });

  it("fullPromptOnMiss は <system>/<user>/<assistant> タグで整形され末尾は最新 user", () => {
    const prompt: LanguageModelV2Prompt = [sys("S"), usr("U1"), asst("R1"), usr("U2")];
    const result = translate(prompt);

    expect(result.fullPromptOnMiss).toMatch(/<system>S<\/system>/);
    expect(result.fullPromptOnMiss).toMatch(/<user>U1<\/user>/);
    expect(result.fullPromptOnMiss).toMatch(/<assistant>R1<\/assistant>/);
    expect(result.fullPromptOnMiss.trim().endsWith("<user>U2</user>")).toBe(true);
  });
});
