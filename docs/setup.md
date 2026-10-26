# クラウドで使う（claude.ai の Project）

手元の Claude Code で使うだけなら、このページは要りません。[README](../README.md) の「はじめかた」で足ります。

claude.ai の Project を使うと、Project の会話に依頼を書くだけで、1件ずつ別のスレッドで並行して進みます。PR のラベルやマージをきっかけにした学習や、毎晩の振り返りも自動で回せます。所要時間の目安は30分です。

## 1. デザインを置くリポジトリを用意する
1. 手元で、デザインを置くリポジトリに `/tanren:studio-init` を実行し、GitHub に push します。
2. そのリポジトリに Claude GitHub App を入れます（https://github.com/apps/claude）。PR をきっかけに動く設定に要ります。

## 2. Project を作る
claude.ai/code → Projects → New project

| 項目 | 設定 |
|---|---|
| Repository | 1 のリポジトリ |
| Instructions | [project-instructions.md](project-instructions.md) の本文を貼る |
| Environment | 新しく作る。Setup script に `npm ci && npx playwright install --with-deps chromium`。リニューアルの案件をやるなら、Network access を Custom にして対象サイトのドメインを足す（または Full） |
| Connectors | Figma、Slack（通知を使うなら）、GitHub |
| Plugins | marketplace に `monkeikawashima/tanren` を足し、`tanren` を有効にする |

> [!IMPORTANT]
> Project のスレッドでは、リポジトリの `.claude/settings.json`（plugin の指定・hook・許可の設定）は読み込まれません。tanren のスキル・スタッフ・関門 hook はすべて plugin に入っているので、**Plugins の設定が必須**です。

Figma や Slack を使うなら、リポジトリの `studio/config.json` の `figma.plan_key`（Figma のチーム）と `notify.slack_channel` を埋めて push します。

## 3. スケジュールタスクを作る
Project の **Scheduled tasks** タブから作ります（Project の外で作ったタスクに plugin が読み込まれるかは、まだ確かめていません）。

| 名前 | きっかけ | プロンプト |
|---|---|---|
| studio-feedback | GitHub：pull_request.labeled、Labels に `feedback` | この PR に付いたレビューを design-feedback スキルで処理してください。 |
| studio-merged | GitHub：pull_request.closed、Is merged = true、Title が `design:` で始まる | マージされたこの PR の案件を、design-feedback スキルで「手直しなしで承認」として記録してください（変更要求コメントがあればその内容で）。 |
| studio-coach | 毎日 3:07（JST） | studio-coach スキルを実行してください。 |
| studio-intake（任意） | 毎時 | Slack の #design-requests に前回以降に来た依頼を読み、依頼ごとに design-job スキルで処理してください。既に処理済みの依頼（スレッドに ✅ があるもの）は飛ばし、処理を始めた依頼に ✅ を付けてください。 |

Project の会話に依頼を書くなら、studio-intake は要りません。

## 4. 動作確認
Project の会話に、小さな依頼を1つ書きます。

> 社内勉強会の告知バナー。300x250 と 728x90。タイトル「デザインと AI の現在地」、11月20日 19時、オンライン。

スレッドで `/tanren:design-job` が使え、PR が届けば完了です。Figma と Slack をつないでいれば、Figma の 00 Review と Slack の通知も届きます。
