import { execSync } from "node:child_process";
import type { Logger } from "./logger.js";

/**
 * Attempts to resolve a repository URL for the current workspace.
 * Prioritizes CURSOR_REPO_URL environment variable, then falls back to git remote.
 * Converts SSH URLs to HTTPS format for better compatibility.
 */
export function resolveRepoUrl(log?: Logger): string | undefined {
  if (process.env.CURSOR_REPO_URL) {
    return process.env.CURSOR_REPO_URL;
  }

  try {
    // Try to get the origin remote URL
    let url = execSync("git remote get-url origin", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();

    if (url) {
      // Convert SSH to HTTPS if needed
      // Format: git@github.com:user/repo.git -> https://github.com/user/repo.git
      if (url.startsWith("git@")) {
        url = url.replace(":", "/").replace("git@", "https://");
      }
      url = url.replace(/\.git$/, "");

      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        if (log) log.debug("cursor-provider: ignored non-http repo url", { url });
        return undefined;
      }

      try {
        new URL(url); // Validate URL format
      } catch {
        if (log) log.debug("cursor-provider: ignored invalid repo url format", { url });
        return undefined;
      }

      if (log) {
        log.debug("cursor-provider: resolved repo url", { url });
      }
      return url;
    }
  } catch {
    // Not a git repo or git not available
  }

  return undefined;
}

/**
 * Attempts to resolve the current git branch name.
 */
export function resolveBranch(log?: Logger): string | undefined {
  if (process.env.CURSOR_REPO_BRANCH) {
    return process.env.CURSOR_REPO_BRANCH;
  }

  try {
    // Try to get the current branch name
    const branch = execSync("git branch --show-current", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    }).trim();

    if (branch) {
      return branch;
    }
  } catch {
    // Git not available or not in a branch
  }

  return undefined;
}

/**
 * Resolves both repository URL and branch information.
 */
export function resolveRepoInfo(log?: Logger): { url?: string; branch?: string } {
  return {
    url: resolveRepoUrl(log),
    branch: resolveBranch(log),
  };
}
