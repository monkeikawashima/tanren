---
name: start
description: tanren の入口。`/tanren:start` で呼ばれたときと、「tanren を始めて」「デザイン案件の続きをやって」「デザイン案件はどこまで進んだ？」と言われたときに使う。リポジトリの準備と進行中の案件を確かめ、design-job（新しい依頼・続き）か design-feedback（指摘）に渡す。tanren の名前も案件の続きも出てこない、ふつうのデザインの依頼では design-job を直接使う。
---

# start — tanren の入口

依頼者はこのコマンドだけ覚えていればよい。実際の工程は `design-job` と関門 hook が回すので、ここでは行き先を決めるだけで、工程の中身を書き足さない。

依頼文：$ARGUMENTS

## 1. 準備
`studio/config.json` がなければ、先に `studio-init` スキルで準備し、終わったらこの先へ進む。

## 2. 進行中の案件を確かめる
`.loop/state.json` を読む。`status` が `planning`・`running`・`delivering`・`review` なら進行中で、`request`（古い案件は `job`）が依頼フォルダ。ファイルがない、または `done`・`stopped` なら、進行中の案件はない。

## 3. 行き先を決める
上から順に、最初に当てはまるものを行う。

| 依頼文 | やること |
|---|---|
| 「どこまで」など、状況を聞いている | 進めずに答える。案件 id、`status`、`phase`（レーンがあれば `.loop/lanes/<レーン>.json` の `phase` をレーンごとに）を1行ずつ。進行中の案件がなければ、そう答える |
| 納品物や案件への指摘（「ここ直して」「これは良い」） | `design-feedback` スキルを使い、依頼文をそのまま渡す |
| 空、または「続けて」 × 進行中の案件あり | 4 へ |
| 空、または「続けて」 × 進行中の案件なし | `stopped` なら `stopped_reason` を1行で伝える。AskUserQuestion を1回使い、何を作るかを聞く（「LP・Webサイト」「バナー・SNS画像」「アプリ画面・プロトタイプ」「既存サイトのリニューアル」。文言やサイズは「その他」に書いてもらう）。答えを依頼文にして `design-job` スキルを使う |
| 新しい依頼 × 進行中の案件なし | `design-job` スキルを使い、依頼文をそのまま渡す |
| 新しい依頼 × 進行中の案件あり | AskUserQuestion を1回使い、「今の案件を先に終える（おすすめ）」か「今の案件を止めて新しい依頼を始める」かを聞く。先に終えるなら 4 へ進み、新しい依頼は案件が終わったら受けると伝える。止めるなら `.loop/state.json` の `status` を `stopped`、`stopped_reason` を「新しい依頼のため依頼者が止めた」にしてから `design-job` スキルを使う |

## 4. 続きを回す
`design-job` スキルを読み込み、`status` ごとに次のところから続ける。案件の最初の質問（0 の 5）は聞き直さない。

- `planning`：`state.branch` に切り替え、できているものから次の工程を決める。`<part>/contract.md` がなければ「1. ディレクション」、`<part>/verdicts/explore-*.md` がなければ「2. 探索」の続き、どちらもあれば「2. 探索」の 5 から。
- `running`・`delivering`：何も変えず、案件 id と今の工程を2行で伝えてターンを終える。関門 hook が続きの指示を返す。
- `review`：「4. 最後の確認」へ。`jobs/<id>/artifact.json` に `review` の URL があれば、ページを公開し直さず、その URL で 4 の 2 から聞く。
