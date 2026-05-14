# Changelog

## [1.7.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.6.1...v1.7.0) (2026-05-14)


### Features

* update @cursor/sdk to 1.0.13 and introduce in-memory platform ([8bc7ed8](https://github.com/yohi/opencode-cursor-plugin/commit/8bc7ed882adf194422d8b5fa86f2533c6f27467e))
* update @cursor/sdk to 1.0.13 and introduce in-memory platform ([f8c33f1](https://github.com/yohi/opencode-cursor-plugin/commit/f8c33f124296901a98b511a4effbe2b430268db9))


### Bug Fixes

* **provider:** address code review issues for in-memory platform ([4c4639e](https://github.com/yohi/opencode-cursor-plugin/commit/4c4639ebbc53a8e4602c0b6e02738005c18b0e3d))
* **provider:** wrap getInMemoryPlatform with try/catch and log errors ([650ebc0](https://github.com/yohi/opencode-cursor-plugin/commit/650ebc078ce945b5a4ba5743ce7ecb2477e1bcab))

## [1.6.1](https://github.com/yohi/opencode-cursor-plugin/compare/v1.6.0...v1.6.1) (2026-05-14)


### Bug Fixes

* **ci:** update Node.js version to 26 in workflows and update lockfile ([3b83775](https://github.com/yohi/opencode-cursor-plugin/commit/3b837759b580f50e904a986e01a52d732690750a))

## [1.6.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.5.0...v1.6.0) (2026-05-14)


### Features

* **agent-create:** Agent.create に local モードを追加し、cwd をローカルに設定 ([9aea28d](https://github.com/yohi/opencode-cursor-plugin/commit/9aea28d8570c083142c336f9c251c20e2754dad2))
* **agent:** Agent.create に local: { cwd } を明示 (PoC 成功を受けて採用) ([9aa4ab7](https://github.com/yohi/opencode-cursor-plugin/commit/9aa4ab73ece30d110f4fbe8cff84a7c570b8b740))
* **agent:** POOL容量調整とAgent.createのlocal cwd明示を適用 ([b3706d5](https://github.com/yohi/opencode-cursor-plugin/commit/b3706d58f7173176c6edd144f772ced50b0921c5))
* **agent:** ローカルモードでのエージェント作成をサポート ([68dd3c2](https://github.com/yohi/opencode-cursor-plugin/commit/68dd3c23460e2dfc6d0e681a430c1b2c58a822e3))
* **migration:** Bun から Node.js への移行設計の更新と開発環境整備 ([4236e31](https://github.com/yohi/opencode-cursor-plugin/commit/4236e31f48c200bb29acffd5850fa557c517727e))
* **provider:** プロバイダーモデルのストリーミング対応と型強化 ([e33f979](https://github.com/yohi/opencode-cursor-plugin/commit/e33f979e54c5fb6db758bd864ef0651036b63073))


### Bug Fixes

* **agent-cleanup:** dispose非対称リトライを実装し回帰テストを追加 ([b822f20](https://github.com/yohi/opencode-cursor-plugin/commit/b822f204d93882654907ae6e71eec56e726696a2))
* **agent-cleanup:** エージェント廃棄時のタイムアウト処理を修正し、テスト容易性を向上 ([b6b1822](https://github.com/yohi/opencode-cursor-plugin/commit/b6b18220d2547d90bc5c33c9585d65c4dc76ee0a))
* **phase1-3:** implement missing document requirements and tests ([5a81dc6](https://github.com/yohi/opencode-cursor-plugin/commit/5a81dc63d42bc28a1ba45808e7ff6b6725f197f6))
* **provider:** Bun環境でタイマー関数が正しく動作しない問題を修正 ([9f50b9c](https://github.com/yohi/opencode-cursor-plugin/commit/9f50b9cffb4a97dd2808f7067767440df4d44010))
* **provider:** エラー処理と型安全性を改善 ([5d8d500](https://github.com/yohi/opencode-cursor-plugin/commit/5d8d500377ac95bc95fc66ba0d394b46afd00d39))
* **provider:** クラッシュ解決のため、モデル作成・リスト表示ロジックと型定義をリファクタリング ([4005ac3](https://github.com/yohi/opencode-cursor-plugin/commit/4005ac340e0a59118190b1c960812e22383eba15))
* **provider:** プロトタイプ汚染脆弱性対策とストリームリトライ改善 ([ff52ee7](https://github.com/yohi/opencode-cursor-plugin/commit/ff52ee7d5e94012b427cb0c3f1fbc089b3417627))
* **provider:** プロバイダーのエラー処理とモデルメタデータ取得の堅牢性を向上 ([9aedbcc](https://github.com/yohi/opencode-cursor-plugin/commit/9aedbcc1ba01f38b34bd7517f2caf625d5dffb3e))
* **provider:** モデルIDのプロトタイプ汚染防止とエラーログ強化 ([2a80864](https://github.com/yohi/opencode-cursor-plugin/commit/2a8086481b793d7c9b70539dae59fc41c87bbb98))
* **runtime:** Bun から Node.js 20+ への移行でクラッシュを防止 ([b6c1dfc](https://github.com/yohi/opencode-cursor-plugin/commit/b6c1dfc2aeb2219e202f62babd83cac97a276da2))
* **runtime:** Bun から Node.js 20+ への移行でクラッシュを防止 ([ca9568c](https://github.com/yohi/opencode-cursor-plugin/commit/ca9568c2bb46a01a24811e98294a4bf23e478f93))
* **sdk:** Bunでのクラッシュ回避のためAgent.createからcloud: {}を削除し、再試行ロジックを強化 ([5965776](https://github.com/yohi/opencode-cursor-plugin/commit/5965776c256793ce873973f613e444d573cf83d8))
* **sdk:** Bunでのクラッシュ回避のためAgent.createからcloud: {}を削除し、再試行ロジックを強化 ([876ead0](https://github.com/yohi/opencode-cursor-plugin/commit/876ead0a6cda7bb0877c0c05a91d6f46cb3b2ec1))
* **sdk:** CIでの型チェックエラー(TS2345, TS2454, TS2322)を修正 ([eea3f2f](https://github.com/yohi/opencode-cursor-plugin/commit/eea3f2fca32e9a69c703b766cd6c3aec47edb1e7))
* **sdk:** Codacy指摘事項への対応とコード品質・安全性の向上 ([fa5c614](https://github.com/yohi/opencode-cursor-plugin/commit/fa5c61424f4844a92843cd41d615bbb039702caf))
* **sdk:** さらなる型安全性の確保とセキュリティ・正規化の改善 ([3095d47](https://github.com/yohi/opencode-cursor-plugin/commit/3095d476a2d45b13e055a5fd2d39358381c9a5f3))
* **sdk:** 指摘事項に基づくリファクタリングと不要なデバッグスクリプトの削除 ([7c62ba1](https://github.com/yohi/opencode-cursor-plugin/commit/7c62ba1532080ab7aeb4f1e311601318e9da8cd1))
* **stream-proxy:** 誤った abortSignal チェックを修正し、テストの失敗を解消 ([45fd20e](https://github.com/yohi/opencode-cursor-plugin/commit/45fd20eebb5caeaf88e5b245017a73e960e261d7))


### Performance Improvements

* **agent-pool:** POOL_CAPACITY 8 → 10 ([0c471ef](https://github.com/yohi/opencode-cursor-plugin/commit/0c471ef773fda3501a38354799a506306d54988c))
* **agent-pool:** POOL_CAPACITY を 8 → 10 に引き上げ dispose レース緩和 ([a693fad](https://github.com/yohi/opencode-cursor-plugin/commit/a693fadf682bff8445e319cee0fbdb5ed50b760f))

## [1.5.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.4.0...v1.5.0) (2026-05-10)


### Features

* 認証情報の解決方法を改善し、最新の2026年モデルを追加 ([f52e60c](https://github.com/yohi/opencode-cursor-plugin/commit/f52e60c232476e7c15d57dfbb57ea61f809395b6))


### Bug Fixes

* カレンダー妥当性の検証強化とモデル能力定義の網羅 (assertISODateStringの改善, Claude/GPT-5の能力追加) ([889c8c2](https://github.com/yohi/opencode-cursor-plugin/commit/889c8c21d1bcbaa1aa24cf80ff4027c183a0473d))
* コードレビューの指摘事項を修正 (型安全性、ロギング、テストの改善) ([d89f8eb](https://github.com/yohi/opencode-cursor-plugin/commit/d89f8ebca425de78091fd31f70c3f1ffba47e518))
* コードレビューの指摘事項を反映 (capabilities, 型定義, ログ, テストの最終調整) ([672574f](https://github.com/yohi/opencode-cursor-plugin/commit/672574f6f43471a306c6e6ad9529f76f2b6182e3))
* メタデータの一貫性向上とバリデーションの徹底 (attachmentフラグの自動同期, releaseDateのランタイムチェック追加) ([5d7a1d6](https://github.com/yohi/opencode-cursor-plugin/commit/5d7a1d617d65d22c6f2f86ce1c41216ef8776c46))
* リソース管理の適正化とテストの安定性向上 (timeoutの解除、Codacy警告対応、FakeTimersのクリーンアップ) ([e4153eb](https://github.com/yohi/opencode-cursor-plugin/commit/e4153eb9f34f4ed7dd1ee481ec264a33aef09eea))
* 非空判定演算子(!)を削除し、型安全な実装に変更 (Codacy警告への対応) ([9fb6b98](https://github.com/yohi/opencode-cursor-plugin/commit/9fb6b98cfc70e024eaa85656180e89c1a0a4112d))

## [1.4.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.8...v1.4.0) (2026-05-10)


### Features

* 2026年5月時点の最新モデル仕様への対応とドキュメント更新 ([bc633d6](https://github.com/yohi/opencode-cursor-plugin/commit/bc633d61a897a7b810af5c289a505012ac34fdab))
* **models:** モデルの capability を動的に設定 ([c047917](https://github.com/yohi/opencode-cursor-plugin/commit/c0479176a059b4c3df5d6e35297026351c33d576))

## [1.3.8](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.7...v1.3.8) (2026-05-10)


### Bug Fixes

* **@cursor/sdk:** @cursor/sdk を v1.0.12 にアップデート ([c2ebb02](https://github.com/yohi/opencode-cursor-plugin/commit/c2ebb02647feb70c75192041224ad3cced976935))
* **errors:** robust error name detection and RateLimit phase guard ([643f85a](https://github.com/yohi/opencode-cursor-plugin/commit/643f85aaf6699ed390fba9acb9db7c5ff74808a6))
* エラーハンドリングと型安全性を強化し、SDK連携を堅牢化 ([1bd0b2c](https://github.com/yohi/opencode-cursor-plugin/commit/1bd0b2c593a20c639741cc38831732d41cb06053))

## [1.3.7](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.6...v1.3.7) (2026-05-10)


### Bug Fixes

* address code review issues and remove redundant cwd ([cbb37c5](https://github.com/yohi/opencode-cursor-plugin/commit/cbb37c59d27845b9aa885d5837203477244407d4))
* merge models instead of overwriting and secure API key logging ([af77963](https://github.com/yohi/opencode-cursor-plugin/commit/af779639a5c37cfd9ce346c9da1c926553186c41))
* replace 'any' with proper types in src/index.ts ([de4f0e0](https://github.com/yohi/opencode-cursor-plugin/commit/de4f0e050ca3ae6f0ef6d1e7fa3e2f3d2d15b9ad))
* use cloud agent execution to prevent native module segfaults ([081f9c6](https://github.com/yohi/opencode-cursor-plugin/commit/081f9c66596e45b7171e402b33870281c747ebdc))

## [1.3.6](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.5...v1.3.6) (2026-05-10)


### Bug Fixes

* bind client.app.log to avoid this._client crash on logging ([5460680](https://github.com/yohi/opencode-cursor-plugin/commit/5460680406857252a6954549c14a722e841a1a69))
* pin @cursor/sdk to 1.0.10 to prevent sqlite3 segfault in Bun ([a877f4c](https://github.com/yohi/opencode-cursor-plugin/commit/a877f4c1804822b7935c6d7d7a8f01f3e577cf5b))

## [1.3.5](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.4...v1.3.5) (2026-05-10)


### Bug Fixes

* correct main and exports paths to point to dist/index.js instead of dist/src/index.js ([f4cf95d](https://github.com/yohi/opencode-cursor-plugin/commit/f4cf95d6417f35d2c736030d8d5285abd255c327))
* **provider:** chat.paramsのチェック条件を簡潔化 ([38ebf36](https://github.com/yohi/opencode-cursor-plugin/commit/38ebf36ef0f6103daa66bb884eaf9b2b1b64d3fd))
* **provider:** gracefully handle synchronous errors in doStream to prevent core crashes ([331204b](https://github.com/yohi/opencode-cursor-plugin/commit/331204bd337cf05c8a0cdc46e550be3df195a9e1))
* resolve this._client crash by binding SDK methods and update @cursor/sdk to v1.0.12 ([cf4e16f](https://github.com/yohi/opencode-cursor-plugin/commit/cf4e16f103f9d6da381104c566a5259b5dbdef8b))
* 認証処理とストリームイベントペイロードの修正 ([b83cb20](https://github.com/yohi/opencode-cursor-plugin/commit/b83cb204ba215bc979bdf88e76293ebade8c932d))

## [1.3.4](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.3...v1.3.4) (2026-05-09)


### Bug Fixes

* adjust tests to match model metadata schema change ([904d33c](https://github.com/yohi/opencode-cursor-plugin/commit/904d33c155a8c3da9ec9de7e78302596027a898e))
* propagate model status to OpenCode metadata with validation ([e7f9560](https://github.com/yohi/opencode-cursor-plugin/commit/e7f9560d76b821b70207c6a10e47f37b4c6b1ee3))
* resolve 400 error by removing invalid model status 'active' ([5353b6a](https://github.com/yohi/opencode-cursor-plugin/commit/5353b6ac0f43c18cda9a198439f83cb85ad2cce8))

## [1.3.3](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.2...v1.3.3) (2026-05-09)


### Bug Fixes

* **ci:** ensure build is run before publish ([515bb48](https://github.com/yohi/opencode-cursor-plugin/commit/515bb48f41fec44a7ed89eb3cdf2c7c23a962ba9))
* remove invalid comment in package.json to fix parse error ([fa3cc5a](https://github.com/yohi/opencode-cursor-plugin/commit/fa3cc5adc6a223ed05e63d7d0427726e5d6c8a59))

## [1.3.2](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.1...v1.3.2) (2026-05-09)


### Bug Fixes

* **provider:** opencode-cursor サブモジュールの削除により認識問題を修正 ([7872f57](https://github.com/yohi/opencode-cursor-plugin/commit/7872f5708ba1c64c240e716add4242587bfd9ac4))
* README のローカルソースパスと tsconfig 設定を修正 ([7fe3aa8](https://github.com/yohi/opencode-cursor-plugin/commit/7fe3aa80b32e750fc84c2b9d0886eb6f733beb92))
* パッケージ構成を隠しディレクトリからsrcへ移動し、プロバイダー認識エラーを解消 ([975a89d](https://github.com/yohi/opencode-cursor-plugin/commit/975a89d9fa1e018daa77032cfe1e422522ba6574))

## [1.3.2](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.1...v1.3.2) (2026-05-10)

### Bug Fixes

* パッケージ化された際のプロバイダー認識エラーを解消 (隠しディレクトリからのソース移動)

## [1.3.1](https://github.com/yohi/opencode-cursor-plugin/compare/v1.3.0...v1.3.1) (2026-05-09)


### Bug Fixes

* ESM互換性のためのインポート拡張子追加とpackage.jsonの修正 ([c560e25](https://github.com/yohi/opencode-cursor-plugin/commit/c560e258370c21d50e37747361a0818d9693d10e))
* 型定義生成の有効化とテストのモックパス修正 ([0204f87](https://github.com/yohi/opencode-cursor-plugin/commit/0204f873b98063151199e474184b1b8c10b70d66))

## [1.3.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.2.0...v1.3.0) (2026-05-08)


### Features

* automatically add 'cursor' to enabled_providers ([6576688](https://github.com/yohi/opencode-cursor-plugin/commit/6576688d6f5a03a60dcd0dd2062fe20eeef7a41b))
* **config:** cursor プロバイダー設定の重複追加を防ぐテストを追加 ([60d96d9](https://github.com/yohi/opencode-cursor-plugin/commit/60d96d992665f7902e27b770f363103fb84b32d8))
* **config:** カーソルプロバイダーの自動有効化 ([b72b37a](https://github.com/yohi/opencode-cursor-plugin/commit/b72b37ab0525336dfe68c7645cfa5b1d194aaa91))

## [1.2.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.1.0...v1.2.0) (2026-05-08)


### Features

* **cursor-provider:** 認証情報永続化機能を追加 ([a0e5365](https://github.com/yohi/opencode-cursor-plugin/commit/a0e5365db863e31aa84a31de97af5cb4f7482842))


### Bug Fixes

* **cursor-provider:** v1.1.0 におけるパス解決の失敗と認証永続化の不備を修正 ([a0d812c](https://github.com/yohi/opencode-cursor-plugin/commit/a0d812cee8d885009fd1cd0e4b3111a1fb427098))
* **cursor-provider:** 指摘事項の修正（recreateAgent の cwd 欠落と resolveApiKey の永続化漏れ） ([ba934b1](https://github.com/yohi/opencode-cursor-plugin/commit/ba934b1fd09e6b404521ef1fbe085c509582aaab))

## [1.1.0](https://github.com/yohi/opencode-cursor-plugin/compare/v1.0.0...v1.1.0) (2026-05-08)


### Features

* **cursor-provider:** Cursorプロバイダーの認証処理を改善し、OAuthトークンのリフレッシュに対応 ([b1a061a](https://github.com/yohi/opencode-cursor-plugin/commit/b1a061a879cf29671d0655a7808d40c6a70a8547))
* **cursor-provider:** 認証フローの刷新と動的モデル取得機能の実装 ([cb5c6b8](https://github.com/yohi/opencode-cursor-plugin/commit/cb5c6b89d437c91887226da3e8c7ef9dae4a552c))


### Bug Fixes

* cursor provider のモデル登録と起動経路を修正 ([418a777](https://github.com/yohi/opencode-cursor-plugin/commit/418a777b58e7d7aa631838b62384b36ad431563e))
* **cursor-provider:** Cursor認証: タイムアウトと中断処理の改善 ([611b412](https://github.com/yohi/opencode-cursor-plugin/commit/611b41219ce4fd8e0009e3d74343f0c4c1081a02))
* **cursor-provider:** プロキシのストリーミングエラーハンドリングを修正 ([53e97cd](https://github.com/yohi/opencode-cursor-plugin/commit/53e97cd01b1adbf5d1f9dbe982417e944bf3cce9))
* **cursor-provider:** 認証エラー処理とプロキシ応答を改善 ([f041495](https://github.com/yohi/opencode-cursor-plugin/commit/f041495bfeeaafe199a6e1eb806073fc48114932))
* **cursor-provider:** 認証処理の堅牢化とモデルメタデータ管理の改善 ([ef63e07](https://github.com/yohi/opencode-cursor-plugin/commit/ef63e0768c59ac3a9f269bf456ba9e5eb81b499e))
* **cursor-provider:** 認証周りの安全性向上とモデル取得処理の改善 ([b4a7385](https://github.com/yohi/opencode-cursor-plugin/commit/b4a73853bd66f5142a18e94b1153f41575606587))

## 1.0.0 (2026-05-04)


### ⚠ BREAKING CHANGES

* **cursor-provider:** provider エントリへ移行し旧 tool を削除

### Features

* **agent-pool:** エージェントプールに delete メソッドを追加 ([432bff9](https://github.com/yohi/opencode-cursor-plugin/commit/432bff9fc2673af0729691bf40b107a1eb04541b))
* **cursor_prompt:** handle run.status error/cancelled (T8, T9) ([29686a7](https://github.com/yohi/opencode-cursor-plugin/commit/29686a77fd105752cb331d8a34d4bf5738213175))
* **cursor_prompt:** handle run.status error/cancelled (T8, T9) ([b2f3bda](https://github.com/yohi/opencode-cursor-plugin/commit/b2f3bdaa09fa9c54892899091049b44e0a5c6f38))
* **cursor_prompt:** implement Agent.create -&gt; send -&gt; wait happy path (T2, T3) ([69f2326](https://github.com/yohi/opencode-cursor-plugin/commit/69f2326684ef5d673eed5bb64c86c737c778813a))
* **cursor_prompt:** implement Agent.create -&gt; send -&gt; wait happy path (T2, T3) ([7174e16](https://github.com/yohi/opencode-cursor-plugin/commit/7174e16e6d48b3b4aed6e53e9fe3d438023839a4))
* **cursor_prompt:** re-throw CursorAgentError-derived exceptions with logging (T4-T7) ([7f6ed57](https://github.com/yohi/opencode-cursor-plugin/commit/7f6ed57e7fed4043ee771fbc5d917b3140f65795))
* **cursor_prompt:** re-throw CursorAgentError-derived exceptions with logging (T4-T7) ([21a8a02](https://github.com/yohi/opencode-cursor-plugin/commit/21a8a021d477420f04d62aff60b95b3fea0ebf3e))
* **cursor_prompt:** release agent in finally and verify log redaction (T10-T12) ([5dca97d](https://github.com/yohi/opencode-cursor-plugin/commit/5dca97d5a8acc9c9659f4a1a353ae22fe5c49897))
* **cursor_prompt:** release agent in finally and verify log redaction (T10-T12) ([f3c5e46](https://github.com/yohi/opencode-cursor-plugin/commit/f3c5e462e3752c2f0e49e59458ea83d619bb7dbf))
* **cursor_prompt:** scaffold plugin with API key validation (T1) ([9f394e3](https://github.com/yohi/opencode-cursor-plugin/commit/9f394e375fc0436e097bcf9c6d6cb16956f3da39))
* **cursor_prompt:** scaffold plugin with API key validation (T1) ([0b2f8f3](https://github.com/yohi/opencode-cursor-plugin/commit/0b2f8f39269391f61cdbe18e7964bc8957334fb0))
* **cursor-provider:** agent cleanup と pool を追加 ([f7ce88a](https://github.com/yohi/opencode-cursor-plugin/commit/f7ce88a48b06780ee659d625777fd46f94e87bef))
* **cursor-provider:** auth と models を追加 ([acf0d68](https://github.com/yohi/opencode-cursor-plugin/commit/acf0d68c4630e4dc0c5cb14edde949c984095b47))
* **cursor-provider:** errors と translator を追加 ([1f5d547](https://github.com/yohi/opencode-cursor-plugin/commit/1f5d547b6b218a827a3b8010f72d0d29ca84fa4e))
* **cursor-provider:** logger モジュールを追加 ([a4d0c30](https://github.com/yohi/opencode-cursor-plugin/commit/a4d0c30ae00cb1e5c67909eb6f90ee57a594f8a6))
* **cursor-provider:** provider hook を追加 ([49cb95d](https://github.com/yohi/opencode-cursor-plugin/commit/49cb95ddf152350bbb811ed7571cdbfa9be92e33))
* **cursor-provider:** provider エントリへ移行し旧 tool を削除 ([43fb4c2](https://github.com/yohi/opencode-cursor-plugin/commit/43fb4c282bf946b07691ed20fd0f5f34e63863b6))
* **cursor-provider:** stream proxy を追加 ([53992de](https://github.com/yohi/opencode-cursor-plugin/commit/53992ded57449b44ef251a0c281ad990d31b9d9a))
* **cursor-provider:** エージェントのクリーンアップ機能とプールを実装 ([6a4d3ec](https://github.com/yohi/opencode-cursor-plugin/commit/6a4d3ecd8271da2c7bc9f94b454ff22ebfad8ab8))
* **cursor-provider:** ストリーミングAPIキー解決とエラーハンドリングを改善 ([0f823a1](https://github.com/yohi/opencode-cursor-plugin/commit/0f823a18f11347d74ea7f556762879d3adcab2fb))
* **cursor-provider:** 非同期クリーンアップとタイムアウトによるエージェントクローズ処理を改善 ([36e8871](https://github.com/yohi/opencode-cursor-plugin/commit/36e88716a3d6e1c137343d98715bd58c27a73dca))
* GitHub Packagesへの公開設定とインストール手順を追加 ([071358e](https://github.com/yohi/opencode-cursor-plugin/commit/071358e6e59fad313980655075d03dd2fbd8eea0))
* **package:** GitHub Packages への公開設定と認証方法を更新 ([4c16fed](https://github.com/yohi/opencode-cursor-plugin/commit/4c16fedcd39e950681d64ad696db9869e7d2e6f9))


### Bug Fixes

* **agent-cleanup:** セキュリティ警告の抑制とCodacy設定の調整 ([8deaf32](https://github.com/yohi/opencode-cursor-plugin/commit/8deaf32c0b541a2a3fe0c67ba9305c65a2e7edcf))
* **agent:** キャンセル時のエージェント再利用を無効化し、コンテキスト汚染を防止 ([1ef35d1](https://github.com/yohi/opencode-cursor-plugin/commit/1ef35d1e378b6b5b09a07a02826df91ee525752c))
* agent変数の暗黙的なany型を解消 ([a43ad89](https://github.com/yohi/opencode-cursor-plugin/commit/a43ad89fdbe26f08581862652b02a782adabcde0))
* **ci:** Devcontainer を使用せず Node.js 上で直接テストと解析を実行するように修正 ([21742e7](https://github.com/yohi/opencode-cursor-plugin/commit/21742e7c6e40d88bca7c8b4dc183fdf8be7cb3dd))
* **ci:** GitHub Actions で Docker が利用できない問題と Dockerfile の不正な指定を修正 ([ec0f067](https://github.com/yohi/opencode-cursor-plugin/commit/ec0f067abb6d076ef681269fda9901931e70082b))
* **ci:** ランナーを ubuntu-slim に変更 ([f0f35e6](https://github.com/yohi/opencode-cursor-plugin/commit/f0f35e680e03fb052b675968e0aa44cef647b25c))
* clear dangling timeout in cleanup function ([c3cf6be](https://github.com/yohi/opencode-cursor-plugin/commit/c3cf6bec5b7580f42e17fa0ae3b565249dbc9e99))
* cursor_prompt ツールのロギング安全性、リソース管理、およびテストの改善 ([492774e](https://github.com/yohi/opencode-cursor-plugin/commit/492774e0de1814b83d4210bb0433b499a201bc56))
* **cursor-provider:** agent-pool の容量検証追加、API キーフィンガープリント生成の完全化、およびテスト修正 ([edf3eaa](https://github.com/yohi/opencode-cursor-plugin/commit/edf3eaa312160be75a78a7dc2ae335abc4befb9d))
* **cursor-provider:** AgentPool APIキーフィンガープリントのテストロジックを修正 ([1b8535c](https://github.com/yohi/opencode-cursor-plugin/commit/1b8535cec7642e9874f2886e2e6d7ccd5ed3f846))
* **cursor-provider:** APIキーフィンガープリントの衝突リスク低減のため文字数を拡張 ([1c1be8a](https://github.com/yohi/opencode-cursor-plugin/commit/1c1be8a006dd01bab3a868e856774a08f21dd53e))
* **cursor-provider:** listModelsWithTimeout におけるタイマーのクリア漏れを修正 ([8568778](https://github.com/yohi/opencode-cursor-plugin/commit/85687789d04b1dbd51d3622892e28e44e7570c35))
* **cursor-provider:** manage agent lifecycle correctly with exclusive checkout ([8ebdf3e](https://github.com/yohi/opencode-cursor-plugin/commit/8ebdf3ec973630306561b7d6f92a40ad34fa6b83))
* **cursor-provider:** エージェントプール: rekey および内部キー管理におけるハッシュ衝突バグを修正 ([b815387](https://github.com/yohi/opencode-cursor-plugin/commit/b815387bb97435faf9f248ec934eb16959a49739))
* **cursor-provider:** エージェントプールのリソース解放を改善し、READMEを更新 ([e447068](https://github.com/yohi/opencode-cursor-plugin/commit/e4470680f9e3e875c46ee401d3a89923e1b635a1))
* **cursor-provider:** エージェントプール管理の堅牢性とパフォーマンスを改善 ([22544f4](https://github.com/yohi/opencode-cursor-plugin/commit/22544f43bd3af66c0323c81a6b5d34d180d8211b))
* **cursor-provider:** レート制限エラーのバックオフ追加、ロギングコンテキスト制限、HTMLエスケープ導入 ([64f1121](https://github.com/yohi/opencode-cursor-plugin/commit/64f1121aacdbbc23696f6be5cca5468dc6615054))
* **cursor:** isolate provider context using closure instead of module-level variable ([d25fa9b](https://github.com/yohi/opencode-cursor-plugin/commit/d25fa9bd0fd91af01f8deafd5fc673415468c9fc))
* Cursor実行ステータスの異常系ハンドリングの改善とテスト強化 ([16bb63a](https://github.com/yohi/opencode-cursor-plugin/commit/16bb63ad3755916d52996624814011372497c705))
* **deps:** 依存関係の脆弱性修正と開発環境設定の更新 ([30562a3](https://github.com/yohi/opencode-cursor-plugin/commit/30562a38f48f11d5a4dd2fbed3bd77e0228209f8))
* **errors:** NetworkError のリトライ判定をフェーズごとに最適化 ([f57eb37](https://github.com/yohi/opencode-cursor-plugin/commit/f57eb3705e18cd9b57775977daac8ceb0bafdd71))
* **errors:** NetworkErrorの再試行を防止し、ストリーム重複を回避 ([6d0c75d](https://github.com/yohi/opencode-cursor-plugin/commit/6d0c75dfba9496c3f1bce75324142456af794c36))
* **errors:** ストリーム重複防止のためのNetworkError再試行ロジックのテスト修正 ([9fbbd6f](https://github.com/yohi/opencode-cursor-plugin/commit/9fbbd6f9c8c7da9f62823d07d0b6d8591c18db48))
* StreamProxy のリスナーリーク修正とテスト安定性向上 ([617f3b3](https://github.com/yohi/opencode-cursor-plugin/commit/617f3b3fd75fe0ef0a4389f1cc936b4db1f1271c))
* Zodのバージョン不整合を解消しバリデーションを強化 ([2214c3f](https://github.com/yohi/opencode-cursor-plugin/commit/2214c3fbadabde11d09c20444a4e86daac7d367d))
* コードレビューの指摘事項（Issue 1-3）への対応 ([13f7e44](https://github.com/yohi/opencode-cursor-plugin/commit/13f7e44d4933b387a2ab480e6cedaced93fe9f8f))
* コードレビューの指摘事項（第2ラウンド：Issue 1-3）への対応 ([56313d9](https://github.com/yohi/opencode-cursor-plugin/commit/56313d9fc74cab5d9150f95194256d6b3b3d185f))
* コードレビューの指摘事項に対応 (Issue 1-4, APIキーバリデーション強化) ([749a71b](https://github.com/yohi/opencode-cursor-plugin/commit/749a71b111c0c8aa9c4e41a729a98c0282d93ebe))
* コードレビュー指摘に基づく例外ハンドリングの改善とテストの修正 ([5e98100](https://github.com/yohi/opencode-cursor-plugin/commit/5e98100ea0a7a682cb72e71a1405567d3b26c5ef))
* ステータス異常時にログが二重出力される問題を修正 ([59d016b](https://github.com/yohi/opencode-cursor-plugin/commit/59d016b02e62569f65c19698a0e5fef4f3259af2))
* 予期せぬエラー発生時に型とメッセージをログ出力するように改善 (Nitpick対応) ([677db35](https://github.com/yohi/opencode-cursor-plugin/commit/677db358751cf5953569abd9ae327e3372267015))
