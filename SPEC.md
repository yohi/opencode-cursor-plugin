# OpenCode Cursor SDK カスタムツールプラグイン 仕様書 (SPEC.md)

## 1. 目的とスコープ

OpenCode のプラグインアーキテクチャに準拠し、Cursor 公式 SDK (`@cursor/sdk`) 経由で Cursor エージェントを呼び出す単一のカスタムツール `cursor_prompt` を提供する。OpenCode セッション中、ユーザは任意のプロンプトを Cursor エージェントへ送信して応答テキストを取得できる。

**スコープ外:**
- Web サーバや外部 API ゲートウェイの構築
- 複数ツールの同時実装（将来の拡張余地は残すが、現時点では 1 ツールに集中）
- ストリーミング応答、トークン制御、システムプロンプト等の高度な調整パラメータ（YAGNI）

## 2. アーキテクチャ概要

```text
[OpenCode Runtime]
      │ load plugin (.opencode/plugins/custom-tools.ts)
      ▼
[CustomToolsPlugin] ── async ({ client }) => { tool: { cursor_prompt } }
      │ on tool call
      ▼
[execute(args)]
   ├─ validate process.env.CURSOR_API_KEY (missing → log.error + throw)
   ├─ resolve model: args.model ?? DEFAULT_LOCAL_MODEL ("composer-2")
   │
   ├─ // try {
   │    ├─ Agent.create({ apiKey, model: { id }, local: { cwd } })
   │    ├─ agent.send(args.prompt)               // → Run
   │    ├─ run.wait()                            // → RunResult
   │    └─ result.status === "finished" ? result.result : throw
   │
   └─ // } finally { agent.close() }
```

## 3. 採用アプローチと判断根拠

| 設計判断 | 採用案 | 根拠 |
|---|---|---|
| ツール用途 | 汎用プロンプト実行 | 仕様の「推測による追加機能を実装しない」制約に忠実。Cursor SDK の薄いラッパーとして将来拡張容易 |
| 引数構成 | `prompt` 必須 + `model` 任意 | LLM 呼び出しでモデル選択は実用上ほぼ必須。`systemPrompt` 等は YAGNI |
| ロギング | カスタム Logger 実装 | 機微情報の保護。`console.log` 禁止の制約。レベル分けによる運用観測性の確保 |
| 環境変数 | 実行時のみ読込 (`dotenv`) | テスト環境と実行時で設定の競合を防ぐため `NODE_ENV !== "test"` の条件を追加 |

## 4. コンポーネント構成

| パス | 役割 |
|---|---|
| `.opencode/plugins/custom-tools.ts` | プラグインエントリ。`cursor_prompt` ツール本体 |
| `package.json` | 依存関係と NPM スクリプト |
| `.devcontainer/` | Node 20 開発環境 |
| `tests/` | vitest ベースのユニットテスト |
| `tsconfig.json`, `vitest.config.ts` | ビルド・テスト設定 |

## 5. ツール仕様

### 5.1 メタ情報

- **name**: `cursor_prompt`
- **description**: 「Cursor エージェントへ任意のプロンプトを送信し、応答テキストを取得します。引数 prompt は必須、model はオプション（未指定時は DEFAULT_LOCAL_MODEL "composer-2" を使用）。」

### 5.2 args（Zod スキーマ）

- `prompt` (string): Cursor エージェントへ送信するユーザープロンプト本文。必須（トリム後 1 文字以上）。
- `model` (string): Cursor 側で利用するモデル識別子。任意（トリム後 1 文字以上）。

### 5.3 execute フロー

1. **環境変数検証**: `process.env.CURSOR_API_KEY` の存在および空文字でないことを確認。無効時はエラー送出。
2. **モデル解決**: 引数 `model` の指定がない場合、`"composer-2"` をデフォルトとして採用し `log.warn` で記録。
3. **エージェント生成**: `Agent.create`（APIキー、対象モデル、ローカルディレクトリ指定）を呼び出す。
4. **プロンプト送信と待機**: `agent.send` 後、`run.wait()` で `RunResult` 完了を待つ。
5. **例外処理**: SDK 呼び出し中の `NetworkError`, `CursorAgentError` および予期せぬ例外を `catch` ブロックで補足し、`log.error` の後、再スロー。
6. **実行ステータスの検証**: `run.wait()` 完了後、`RunResult.status` が `"error"` や `"cancelled"` の場合は内容をログに書き出してエラー送出。
7. **リソース解放**: `try/finally` 句の中で必ず `agent.close()` を呼ぶ。
8. **完了**: `status === "finished"` の場合、エージェントからの応答テキストを返却。

## 6. エラーハンドリングとエッジケース

| 失敗ケース | 検出箇所 | 動作 | 期待される出力 |
|---|---|---|---|
| `CURSOR_API_KEY` 未設定 / 空文字 | `execute` 冒頭 | `log.error` → `Error("CURSOR_API_KEY is not set...")` を throw | OpenCode 側でツール呼び出しが失敗し、ユーザにメッセージ表示 |
| `prompt` が空文字 | OpenCode ランタイム（Zod） | プラグインに到達せず Zod が自動拒否 | Zod のバリデーションエラーメッセージ |
| `prompt` が極端に長い | プラグイン側ではチェックせず SDK に委譲 | SDK が `RateLimitError` または `ConfigurationError` を throw → `log.error` 後 re-throw | エラーメッセージに超過の旨が含まれる |
| `model` が SDK で未知の識別子 | `Agent.create` または初回 `send` 時 | `ConfigurationError` を catch → `log.error` 後 re-throw | エラーメッセージに無効モデル名の旨が含まれる |
| 認証失敗（無効な API キー） | `Agent.create` または `agent.send` 内 | `AuthenticationError` を catch → `log.error` 後 re-throw | エラーメッセージに認証失敗の旨が含まれる |
| ネットワーク失敗 | `Agent.create` または `agent.send` 内 | `NetworkError` を catch → `error.isRetryable` をログに記録後 re-throw（リトライは行わない） | エラーメッセージにネットワーク失敗の旨が含まれる |
| レート制限 | `agent.send` 中 | `RateLimitError` を catch → `log.error` 後 re-throw | エラーメッセージにレート制限の旨が含まれる |
| `run.status === "error"` | `run.wait()` 後 | `log.error` でサニタイズ済みメタ情報のみ記録 → `Error("Cursor run finished with status=error")` を throw | エラーメッセージに run の id と status |
| `run.status === "cancelled"` | `run.wait()` 後 | 同上のサニタイズ済みメタ情報のみ記録 → `Error("Cursor run was cancelled")` を throw | エラーメッセージに cancellation の旨 |
| その他 `CursorAgentError` 派生 | 任意 | `log.error` 後 re-throw | エラーメッセージとサブクラス名 |
| 予期せぬ例外 | 任意 | `log.error` 後 re-throw | 型（例: `TypeError`）とエラーメッセージ |

## 7. ロギングと機微情報の保護

ログは提供された `client.app.log` を使って安全に処理される。
- **機微情報の非出力**: API キー、`prompt` 本文、および応答本文はログデータに含めず、長さ（`length`）などのメタ情報のみを出力する。
- **ログレベル**:
  - `debug`: 呼び出し直後
  - `info`: 進行状況（エージェント生成、完了など）
  - `warn`: モデル未指定フォールバック、クローズ失敗など
  - `error`: API キー欠落や SDK エラー時（`run.status === "error"` / `"cancelled"` を含む）

## 8. CIとテストの戦略

- GitHub Actions (`.github/workflows/ci.yml`) を用いて、`master` ブランチへの Push / Pull Request トリガーで静的解析と自動テストを実行。
- **テストランナー**: `vitest`
- テスト内容は以下を網羅:
  - 必須環境変数のバリデーション（未設定や空文字）
  - モデル引数のデフォルト置換と明示的設定
  - SDK 各種エラー時の伝播確認
  - 成功・エラーを問わない `agent.close` の確実な実行
  - ログに API キーやプロンプト本文が含まれないことの保証
