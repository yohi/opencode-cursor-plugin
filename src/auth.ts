import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";
import { generatePKCE } from "./pkce.js";
import type { Logger } from "./logger.js";

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

const CURSOR_REQUEST_TIMEOUT = 30000;
const CURSOR_POLL_REQUEST_TIMEOUT = 5000;

export async function resolveAndPersistApiKey(deps: { 
  auth: unknown; 
  log?: Logger 
}): Promise<string | undefined> {
  const { auth, log } = deps;
  const normalizedEnv = process.env.CURSOR_API_KEY?.trim() || undefined;
  if (!auth || typeof auth !== "object") return normalizedEnv;

  try {
    // Note: auth.get/set are methods of the Auth class from @opencode-ai/sdk.
    // They must be called with the correct 'this' context.
    const hasGet = (obj: unknown): obj is { get: (...args: unknown[]) => unknown } => 
      typeof obj === "object" && obj !== null && "get" in obj && typeof (obj as Record<string, unknown>).get === "function";
    const hasSet = (obj: unknown): obj is { set: (...args: unknown[]) => unknown } => 
      typeof obj === "object" && obj !== null && "set" in obj && typeof (obj as Record<string, unknown>).set === "function";
    const hasAuthenticate = (obj: unknown): obj is { authenticate: (...args: unknown[]) => unknown } => 
      typeof obj === "object" && obj !== null && "authenticate" in obj && typeof (obj as Record<string, unknown>).authenticate === "function";

    let savedAuth: unknown;
    if (hasGet(auth)) {
      savedAuth = await (auth as { get: (...args: unknown[]) => Promise<unknown> }).get.call(auth, { path: { id: "cursor" } }).catch(() => undefined);
    } else if (hasAuthenticate(auth)) {
      const authPromise = (auth as { authenticate: (...args: unknown[]) => Promise<unknown> }).authenticate.call(auth, { id: "cursor" });
      let timeoutId: NodeJS.Timeout | undefined;
      savedAuth = await Promise.race([
        authPromise,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error("auth.authenticate timeout"));
          }, 2000);
        })
      ]).catch((err) => {
        if (log) {
          log.warn("cursor-provider: auth.authenticate failed or timed out", { error: err instanceof Error ? err.message : String(err) });
        }
        return undefined;
      }).finally(() => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      });
    }
    
    const result = await getOrRefreshToken(savedAuth || auth, async (tokens) => {
      if (hasSet(auth)) {
        await (auth as { set: (...args: unknown[]) => Promise<void> }).set.call(auth, {
          path: { id: "cursor" },
          body: {
            type: "oauth",
            access: tokens.accessToken,
            refresh: tokens.refreshToken,
            expires: getTokenExpiry(tokens.accessToken),
          },
        }).catch((err: unknown) => {
          if (log) {
            log.warn("cursor-provider: failed to persist refreshed token", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }
    });
    const finalKey = result?.apiKey || normalizedEnv;
    if (log && finalKey) {
      log.debug("cursor-provider: resolved API key", {
        source: result?.apiKey ? "saved-auth" : "env",
      });
    }
    return finalKey;
  } catch (err) {
    if (log) {
      log.error("cursor-provider: resolveAndPersistApiKey failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return normalizedEnv;
  }
}

export async function resolveApiKey(ctx: ProviderHookContext, log?: Logger): Promise<string | undefined> {
  return resolveAndPersistApiKey({ auth: ctx.auth, log });
}

export async function getOrRefreshToken(
  auth: unknown,
  onRefresh?: (tokens: { accessToken: string; refreshToken: string }) => Promise<void>,
): Promise<{ apiKey: string } | undefined> {
  if (!auth || typeof auth !== "object") return undefined;

  const isAuthWithData = (obj: unknown): obj is { type: string; key?: string; access?: string; refresh?: string; expires?: number } => 
    typeof obj === "object" && obj !== null && "type" in obj && typeof (obj as Record<string, unknown>).type === "string";

  if (!isAuthWithData(auth)) return undefined;

  if (auth.type === "api") {
    const key = typeof auth.key === "string" ? auth.key.trim() : "";
    return key ? { apiKey: key } : undefined;
  }

  if (auth.type === "oauth") {
    // 期限切れチェック
    const expires = typeof auth.expires === "number" ? auth.expires : undefined;
    if (expires && expires < Date.now()) {
      try {
        const refresh = typeof auth.refresh === "string" ? auth.refresh : "";
        const refreshed = await refreshCursorToken(refresh);
        if (onRefresh) {
          await onRefresh(refreshed);
        }
        return { apiKey: refreshed.accessToken };
      } catch {
        // リフレッシュ失敗時はundefinedを返してフォールバックを促す
        return undefined;
      }
    }
    const access = typeof auth.access === "string" ? auth.access : undefined;
    return access ? { apiKey: access } : undefined;
  }
  return undefined;
}

export const cursorAuthHook: AuthHook = {
  provider: "cursor",
  async loader(getAuth, _provider) {
    const auth = await getAuth();
    const result = await getOrRefreshToken(auth);
    if (result) return result;

    const envKey = process.env.CURSOR_API_KEY;
    return envKey ? { apiKey: envKey } : {};
  },
  methods: [
    {
      type: "oauth",
      label: "Login with Browser (Recommended)",
      async authorize() {
        const { verifier, challenge } = await generatePKCE();
        const uuid = crypto.randomUUID();
        const params = new URLSearchParams({
          challenge,
          uuid,
          mode: "login",
          redirectTarget: "cli",
        });

        return {
          url: `${CURSOR_LOGIN_URL}?${params.toString()}`,
          instructions: "Please complete login in your browser.",
          method: "auto",
          async callback() {
            const tokens = await pollCursorAuth(uuid, verifier);
            return {
              type: "success",
              access: tokens.accessToken,
              refresh: tokens.refreshToken,
              expires: getTokenExpiry(tokens.accessToken),
            };
          },
        };
      },
    },
    {
      type: "api",
      label: "Manual API Key Entry",
      prompts: [
        {
          key: "key",
          message: "Cursor API Key (crsr-...)",
          type: "text",
        },
      ],
    },
  ],
};

async function pollCursorAuth(uuid: string, verifier: string) {
  // Validate inputs
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) {
    throw new Error("Invalid UUID format");
  }
  if (!/^[a-z0-9._~-]{43,128}$/i.test(verifier)) {
    throw new Error("Invalid verifier format");
  }

  const url = new URL(CURSOR_POLL_URL);
  url.searchParams.set("uuid", uuid);
  url.searchParams.set("verifier", verifier);

  // 最大 5分間ポーリング
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CURSOR_POLL_REQUEST_TIMEOUT);

    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (res.ok) {
        const tokens = (await res.json()) as { accessToken: string; refreshToken: string };
        return tokens;
      }
    } catch (err) {
      // タイムアウトやネットワークエラーは試行の1つとして扱い、ポーリングを継続する
      if (err instanceof Error && err.name === "AbortError") {
        // continue to next iteration
      } else {
        // 他のネットワークエラーも同様に継続
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("Authentication timed out.");
}

async function refreshCursorToken(refreshToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CURSOR_REQUEST_TIMEOUT);

  try {
    const res = await fetch(CURSOR_REFRESH_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshToken}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error("Token refresh failed.");
    return (await res.json()) as { accessToken: string; refreshToken: string };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Token refresh timed out after ${CURSOR_REQUEST_TIMEOUT}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function getTokenExpiry(token: string): number {
  try {
    const parts = token.split(".");
    const part1 = parts[1];
    if (!part1) return Date.now() + 3600 * 1000;
    const payload = JSON.parse(Buffer.from(part1, "base64").toString());
    if (typeof payload !== "object" || payload === null || typeof payload.exp !== "number") {
      return Date.now() + 3600 * 1000;
    }
    return payload.exp * 1000 - 60000; // 1分前に期限切れとみなす
  } catch {
    return Date.now() + 3600 * 1000;
  }
}
