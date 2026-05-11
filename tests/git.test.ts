import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveRepoUrl } from "../src/git.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("resolveRepoUrl", () => {
  const originalEnv = process.env.CURSOR_REPO_URL;

  afterEach(() => {
    process.env.CURSOR_REPO_URL = originalEnv;
    vi.clearAllMocks();
  });

  it("CURSOR_REPO_URL があればそれを優先する", () => {
    process.env.CURSOR_REPO_URL = "https://github.com/user/env-repo";
    expect(resolveRepoUrl()).toBe("https://github.com/user/env-repo");
    expect(execSync).not.toHaveBeenCalled();
  });

  it("CURSOR_REPO_URL がなければ git remote を試みる", () => {
    delete process.env.CURSOR_REPO_URL;
    vi.mocked(execSync).mockReturnValue("https://github.com/user/git-repo\n" as any);
    expect(resolveRepoUrl()).toBe("https://github.com/user/git-repo");
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining("git remote get-url origin"), expect.anything());
  });

  it("SSH 形式の URL は HTTPS 形式に変換される", () => {
    delete process.env.CURSOR_REPO_URL;
    vi.mocked(execSync).mockReturnValue("git@github.com:user/repo.git\n" as any);
    expect(resolveRepoUrl()).toBe("https://github.com/user/repo");
  });

  it("git が失敗した場合は undefined を返す", () => {
    delete process.env.CURSOR_REPO_URL;
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("git not found");
    });
    expect(resolveRepoUrl()).toBeUndefined();
  });
});
