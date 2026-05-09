#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "WARNING: CURSOR_API_KEY が未設定です。実際の API 呼び出しを含む場合は設定が必要です。" >&2
fi

echo "[E2E] cursor-provider 手動 E2E"
echo "[Step 1] opencode.jsonc にローカルプラグインが設定済みか確認してください:"
echo '  "plugins": [["./src/index.ts", {}]]'
echo '  "provider": { "default": "cursor/composer-2" }'
echo "[Step 2] opencode を起動 → /provider cursor → composer-2 を選択"
echo "[Step 3] 'Hello, what model are you?' を送信し、ストリーミング応答を確認"
echo "[Step 4] 連続 2 ターン目でプールヒット (debug ログ) を確認"
