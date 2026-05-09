# OpenCode Cursor Provider プラグイン仕様書 (SPEC.md)

このドキュメントは OpenCode Cursor Provider プラグイン (v0.2.0以降) の技術仕様・アーキテクチャ設計を定義します。

## 1. 目的とスコープ

OpenCode のメイン LLM プロバイダーとして Cursor Headless SDK (`@cursor/sdk`) を直接利用できるようにします。旧 `cursor_prompt` カスタムツールは廃止されました。

### スコープ外
- Cursor アカウントの OAuth 自動ログイン
- OpenCode の MCP ツール群を Cursor 側へ完全同期する機能

## 2. 設計判断サマリ

| テーマ | 採用 | 根拠 |
|---|---|---|
| 既存ツール | `cursor_prompt` 完全削除 | Provider が代替 |
| モデル一覧 | 動的取得 + 静的フォールバック | 最新モデル反映と起動信頼性の両立 |
| エージェント性 | Pure LLM モード | 二重エージェント問題回避 |
| 履歴の橋渡し | ハッシュ＋プール最適化 / フルプロンプト fallback | レイテンシ最小化と新規／分岐会話への耐性両立 |
| プールライフサイクル | LRU 上限 8、Exclusive Checkout、close 5 秒タイムアウト | 予測可能でリソース漏洩や並列利用時の破損なし |
| ストリームイベント | text 通常 / thinking → reasoning / tool-call → 警告 | Cursor の表現力を活用しつつ Pure LLM 建前を可視化 |
| 認証 | env var + `AuthHook` (browser OAuth / api) | UX 改善。ブラウザ OAuth とリフレッシュトークンに対応 |
| プロバイダー登録 | `config` hook で `provider.cursor` を自動注入 | OpenCode >= 1.14.0 で provider 登録を成立させるため |
| 命名 | `id="cursor"` / default `composer-2` | Cursor ドキュメントと一致 |

## 3. アーキテクチャ概要

```text
[OpenCode Runtime]
  │ ① 起動: PluginInput を渡して初期化
  ▼
[CursorProviderPlugin (entry)]
  │ ② config hook で provider.cursor を補完
  │ ③ AuthHook / ProviderHook 登録
  ▼
  ├─ provider.cursor.options.baseURL = local proxy (http://127.0.0.1:{port}/v1)
  │    ※ ポートは 0 (OS割当) を優先し、失敗時は 32125 を試行。環境変数 CURSOR_PROXY_PORT で固定可能。
  │    ※ プロバイダー初期化時に自動開始され、プロセス終了時にクローズされる。
  └─ models() コールバック
       │ ④ Cursor.models.list() → 失敗時は静的フォールバック
       ▼ OpenCode SDK v2 互換 Model を返却
```,old_string:
[OpenCode 推論時]
  │ ⑤ ユーザーが cursor/composer-2 等を選択して実行
  ▼
[OpenAI-compatible Proxy]
  │ ⑥ OpenCode → `@ai-sdk/openai-compatible` → ローカル proxy
  │ ⑦ proxy が `@cursor/sdk` に変換して送信
  │ ⑧ Translator: messages → 履歴ハッシュ + last user msg
  │ ⑨ AgentPool.tryGet(hash) → ヒット時プールから削除 (Exclusive Checkout)
  │ ⑩ agent.send(msg, { onDelta, onStep })
  │ ⑪ onDelta を ReadableStream に変換
  │ ⑫ ストリーム完了/エラー時にプールへ put(返却) または close(破棄)
  ▼
[OpenCode UI] (リアルタイム描画)
```

## 4. モジュール構成 (`src/`)

- `index.ts`: エントリ。Plugin 関数本体、終了フック
- `config.ts`: `provider.cursor` の自動注入
- `provider.ts`: ProviderHook 実装。ストリーム実行ライフサイクル管理
- `auth.ts`: AuthHook 定義。環境変数または設定からAPIキー解決
- `models.ts`: 静的フォールバックモデルリスト (`STATIC_FALLBACK_MODELS`)、ModelV2 ファクトリ
- `openai-proxy.ts`: OpenAI-compatible API を Cursor SDK へ中継するローカル proxy
- `translator.ts`: 履歴ハッシュ化 (`role="system"` と `role="user"` のみ対象) + プロンプト変換
- `agent-pool.ts`: LRU キャッシュ。排他的チェックアウト (`tryGet`), `put`, `closeAll`
- `stream-proxy.ts`: `agent.send` → `ReadableStream` 変換、二重終端ガード
- `agent-cleanup.ts`: `disposeAgentSafely` (5sタイムアウト付き非同期破棄)
- `logger.ts`: OpenCode ロガーのラップ
- `errors.ts`: Cursor SDK エラーのマッピング、リトライ戦略判定

## 5. データフローと状態管理

### 5.1 履歴のハッシュ化 (`translator.ts`)
- **対象**: `role="system"` と `role="user"` のみ (SHA-256)。
- **理由**: Cursor SDKの Agent は内部で会話状態を保持するため、assistant応答を含めるとターンごとのハッシュが必ず不一致になりプール再利用ができなくなるため。

### 5.2 AgentPool のライフサイクル (Exclusive Checkout)
- **tryGet**: ヒットした場合、即座に Map からエントリを削除します（排他的チェックアウト）。これにより同一エージェントの並列使用による状態破損を防ぎます。
- **実行後**: `provider.ts` の `runDoStream` 側でストリームの `done` を監視し、正常終了なら `pool.put` でプールに戻し、異常終了やキャンセルの場合はそのまま `disposeAgentSafely` で破棄します。

### 5.3 エラーハンドリングとリトライ
- **NetworkError**: `create` / `pre-stream` フェーズ（onDelta未発火）のみ 500ms バックオフで1回リトライ可能。`in-stream` ではチャンク重複を防ぐためリトライしません。
- **UnknownAgentError**: プールヒット時の `pre-stream` フェーズのみ、`provider.ts` が注入した `recreateAgent` コールバック経由で新規エージェントを作り直しフルプロンプトで1回再試行します。
- **キャンセル (AbortSignal / cancel)**: ストリーム処理中にキャンセルされた場合、エージェントは直ちに `disposeAgentSafely` 経由で破棄されます。汚染を防ぐためプールには戻しません。

### 5.4 起動時のモデル一覧解決 (`provider.ts`)
- `Cursor.models.list({ apiKey })` を 5 秒タイムアウトで実行します。
- **リソース管理**: `Promise.race` で使用する `setTimeout` の ID を保持し、`finally` ブロックで確実に `clearTimeout` を呼び出すことで、dangling timer によるリソースリークを防止します。
- 失敗またはタイムアウト時は、`models.ts` で定義された `STATIC_FALLBACK_MODELS` を返却します。

### 5.5 Provider 登録 (`config.ts`)
- `config` hook で `provider.cursor` を自動注入します。
- `provider.cursor` には `@ai-sdk/openai-compatible` と local proxy の `baseURL` を設定します。
- `provider.cursor.whitelist` が指定されていればそのまま保持し、未指定時はプラグイン既定のモデル（`models.ts` の `STATIC_FALLBACK_MODELS`）を注入します。
- **whitelist の目的**: ユーザーが特定のモデルのみを許可したい場合に、表示・利用可能なモデルリストをフィルタリングします。
- **フォーマット**:
    - モデル ID の文字列配列: `["composer-2", "gpt-4o"]`
    - または、表示名を含むオブジェクト配列: `[{ "id": "composer-2", "name": "Cursor Composer" }]`
- **挙動**: ユーザー指定がある場合はそれを優先し、未指定時は `STATIC_FALLBACK_MODELS` を使用します。システムは `models()` フック内でこのリストを参照し、UI に表示するプロバイダーモデルを構築します。

## 6. Tool-call 関連イベントの扱い
- **ToolCallStartedUpdate**: Stream に text-delta として警告メッセージを **1 回のみ** 挿入し、ログ出力します。Pure LLM モードであるため、実行は行われません。
- **PartialToolCallUpdate / ToolCallCompletedUpdate**: 無視（ドロップ）し、JSON断片がUIに漏れるのを防ぎます。

## 7. 機密情報の扱い
- API キーはログに出力しません。識別のための fingerprint (SHA-256化) のみ記録します。
- プロンプト、レスポンス内容は length のみをログ出力します。
