import type { AuthHook, ProviderHookContext } from "@opencode-ai/plugin";
import { generatePKCE } from "./pkce";

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

export async function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined> {
  try {
    const auth = await (ctx.auth as any)?.get?.("cursor");
    const result = await getOrRefreshToken(auth);
    return result?.apiKey || process.env.CURSOR_API_KEY;
  } catch {
    return process.env.CURSOR_API_KEY;
  }
}

export async function getOrRefreshToken(auth: any): Promise<{ apiKey: string } | undefined> {
  if (!auth) return undefined;

  if (auth.type === "api") {
    const key = typeof auth.key === "string" ? auth.key.trim() : "";
    return key ? { apiKey: key } : undefined;
  }

  if (auth.type === "oauth") {
    // 期限切れチェック
    if (auth.expires && auth.expires < Date.now()) {
      try {
        const refreshed = await refreshCursorToken(auth.refresh);
        return { apiKey: refreshed.accessToken };
      } catch {
        // リフレッシュ失敗時は現在のトークンで強行（後続でエラー）
      }
    }
    return auth.access ? { apiKey: auth.access } : undefined;
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

  const url = `${CURSOR_POLL_URL}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(verifier)}`;

  // 最大 5分間ポーリング
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const res = await fetch(url);
    if (res.ok) {
      return (await res.json()) as { accessToken: string; refreshToken: string };
    }
  }
  throw new Error("Authentication timed out.");
}

async function refreshCursorToken(refreshToken: string) {
  const res = await fetch(CURSOR_REFRESH_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${refreshToken}` },
  });
  if (!res.ok) throw new Error("Token refresh failed.");
  return (await res.json()) as { accessToken: string; refreshToken: string };
}

function getTokenExpiry(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return Date.now() + 3600 * 1000;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
    if (typeof payload !== "object" || payload === null || typeof payload.exp !== "number") {
      return Date.now() + 3600 * 1000;
    }
    return payload.exp * 1000 - 60000; // 1分前に期限切れとみなす
  } catch {
    return Date.now() + 3600 * 1000;
  }
}
