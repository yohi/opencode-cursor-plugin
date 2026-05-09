# Changelog

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
