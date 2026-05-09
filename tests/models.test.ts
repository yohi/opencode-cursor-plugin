import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  STATIC_FALLBACK_MODELS,
  makeModelMeta,
} from "../src/models.js";

describe("STATIC_FALLBACK_MODELS", () => {
  it("composer-2 を含み、すべて id/name/contextWindow フィールドを持つ", () => {
    expect(STATIC_FALLBACK_MODELS.some((model) => model.id === "composer-2")).toBe(true);

    for (const model of STATIC_FALLBACK_MODELS) {
      expect(typeof model.id).toBe("string");
      expect(typeof model.name).toBe("string");
      expect(typeof model.contextWindow).toBe("number");
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });

  it("DEFAULT_MODEL_ID は composer-2", () => {
    expect(DEFAULT_MODEL_ID).toBe("composer-2");
  });
});

describe("makeModelMeta", () => {
  it("OpenCode SDK v2 Model 互換のメタデータを返す", () => {
    const meta = makeModelMeta({ id: "composer-2", name: "Composer 2", contextWindow: 200_000 });

    expect(meta.id).toBe("composer-2");
    expect(meta.providerID).toBe("cursor");
    expect(meta.api.id).toBe("cursor");
    expect(meta.limit.context).toBe(200_000);
    expect(meta.limit.output).toBeGreaterThan(0);
    expect(meta.capabilities.input.text).toBe(true);
    expect(meta.capabilities.output.text).toBe(true);
  });
});
