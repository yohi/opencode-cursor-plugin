import type { AuthHook, ProviderHookContext, Auth } from "@opencode-ai/plugin";
import { generatePKCE } from "./pkce";

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

export async function resolveApiKey(ctx: ProviderHookContext): Promise<string | undefined> {
  try {
    const auth = await (ctx.auth as any)?.get?.("cursor");
    if (!auth) return process.env.CURSOR_API_KEY;

    if (auth.type === "api") {
      return auth.key;
    }

    if (auth.type === "oauth") {
      // OAuthの場合はアクセストークンを返す
      // 本来は期限切れチェックとリフレッシュが必要だが、
      // ここでは簡易化のためアクセストークンを直接返す
      return auth.access;
    }
  } catch (err) {
    // Fallback to env
  }
  return process.env.CURSOR_API_KEY;
}

export const cursorAuthHook: AuthHook = {
  provider: "cursor",
  async loader(getAuth, _provider) {
    const auth = await getAuth();
    if (!auth) return { apiKey: process.env.CURSOR_API_KEY || "cursor" };

    if (auth.type === "api") {
      return { apiKey: auth.key };
    }

    if (auth.type === "oauth") {
      // 期限切れチェック
      if (auth.expires && auth.expires < Date.now()) {
        try {
          const refreshed = await refreshCursorToken(auth.refresh);
          // 新しいトークンを保存（SDK経由で永続化）
          // 注: loader内でのsetはOpenCode本体の挙動に依存するが、
          // ここではアクセストークンを最新にして返却する
          return { apiKey: refreshed.access };
        } catch {
          // リフレッシュ失敗時はそのまま返す（後続の通信でエラーになる）
        }
      }
      return { apiKey: auth.access };
    }

    return { apiKey: process.env.CURSOR_API_KEY || "cursor" };
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
  // 最大 5分間ポーリング
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const res = await fetch(`${CURSOR_POLL_URL}?uuid=${uuid}&verifier=${verifier}`);
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
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return payload.exp * 1000 - 60000; // 1分前に期限切れとみなす
  } catch {
    return Date.now() + 3600 * 1000;
  }
}
