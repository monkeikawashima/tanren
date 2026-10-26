---
name: design-job
description: デザインの依頼を受けたら必ず使う。バナー、LP、Webサイト、アプリ画面、UI、プロトタイプ、モック、サイトのリニューアル、SNS画像、OGP、サムネイル、チラシ、ポスター、名刺、スライド、HTMLメール、図解、モーション、ロゴ、アイコンなど。「作って」「デザインして」「モックを作って」「リニューアルして」「案を出して」と頼まれたとき。依頼から方向性の探索、制作、採点、Figma 書き出し、PR 作成まで自動で回す。
---

# design-job — 依頼から PR まで

サブエージェントは `tanren:<名前>`（例：`tanren:director`）で呼ぶ。このリポジトリに `studio/config.json` がなければ、先に `studio-init` スキルで準備する。

依頼者がやるのは依頼文を書くことと、最後のレビューだけ。途中で質問して止まらない（例外は、最初の数件で方向性を選んでもらう「2. 探索」の 5 だけ）。分からないことは仮で決めて、最後に質問として返す。

## 0. 案件を作る
1. 案件 id を `YYYYMMDD-<英語の短い slug>` で決め、`jobs/<id>/` を作る。この案件用のブランチを切る。
2. `${CLAUDE_PLUGIN_ROOT}/studio/brief-template.md` を `jobs/<id>/brief.md` にコピーし、依頼文から埋める。依頼文にないことは「未記入」のまま残す（ここで推測を書かない）。添付やリンク先の素材は `jobs/<id>/assets/`、参考画像は `jobs/<id>/references/` に置く。`studio/taste/references/good/` が空で `rules.md` に箇条もなければ、止まらずに進め、依頼者への質問に「審美眼が空のため、好みを反映できていない。`/tanren:studio-init` の審美眼の種まきを勧める」と書く。
3. 媒体（medium）を `${CLAUDE_PLUGIN_ROOT}/studio/media.md` の一覧から1つ選ぶ。既存サイトの URL があって作り直しなら `renewal`。複数の媒体にまたがる依頼（例：LP とバナー一式）は、媒体ごとに案件を分けて、それぞれ別のスレッドで進める。
4. リニューアルなら `node ${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs --job jobs/<id> --url <URL>` で棚卸しする（環境のネットワーク設定で対象ドメインが許可されている必要がある。失敗したら依頼者への質問に回し、URL なしで進める）。
5. **デザインシステム**：この案件で使うものを決めて、案件に写す。
   - 名前を決める：`node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium>`。brief の「デザインシステム」欄に名前（または「なし」）があれば `--override <名前>`（「なし」は `none`）を付ける。
   - `unset`（未設定）：デザインシステムなしで進め、依頼者への質問に「デザインシステムが未設定。`/tanren:design-system` で決められる」と書く。
   - `none`：デザインシステムなしで進める。
   - 名前が出たら：その名前と `extends` の土台のうち、版を確かめられる取り込み元（Claude の Design System・Figma・コード）の今の版を `studio/design-system/<名前>/source.json` と比べ、変わっていれば `design-system-import` スキルの「更新するとき」で取り直す。取り直したら、progress.md と依頼者への質問に「デザインシステムが更新されていたので取り直した」と書く。確かめられない環境なら、今の写しで進める。
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --resolve <名前> --out jobs/<id>/assets/ds` で、土台と重ねた1つのデザインシステムを案件に写す。成果物はここを相対パスで読む（`assets/ds/tokens.css`、フォント、ロゴ。Artifact のプレビューに一緒に載せるため）。案件はこの写しを最後まで使う（途中で設定が変わっても見た目は変わらない）。
   - 使った名前を brief の「デザインシステム」欄と progress.md に書き、`assets/ds/README.md` の「推定の値」にあるものは依頼者への質問に載せる。
6. `.loop/state.json` を書く（数値は `studio/config.json` の defaults）：

```json
{ "status": "planning", "job": "jobs/<id>", "medium": "<medium>", "phase": "build",
  "pass_score": 8, "build": { "iteration": 0, "max": 10 },
  "usertest": { "iteration": 0, "max": 3 }, "figma": { "enabled": true, "iteration": 0, "max": 5 } }
```
Figma コネクタがこのセッションで使えないなら `figma.enabled` を false にし、依頼者への質問に「Figma 未接続」と書く。

## 1. ディレクション
director サブエージェントを呼ぶ。`contract.md`、`manifest.json`、`tokens.json`、`images.json`、`directions.md`（リニューアルなら `renewal/audit.md` と `renewal/ia.md` も）ができたことを確かめる。

### 1.5 仮の画像
まず `${CLAUDE_PLUGIN_ROOT}/placeholders/placeholders.css` を `jobs/<id>/assets/placeholders/` にコピーする（画像がそろわない所は、designer がこの仮素材で仮置きする）。
そのうえで、画像生成のツール（例：nano-banana の `generate_image`）がこのセッションで使えるなら、`images.json` の `"generate": true` の画像を生成し、`jobs/<id>/assets/gen/<id>.png` に保存する。
- `prompt` に書かれた情景・雰囲気だけを生成する。文字・ロゴ・実在の人物や商品が写った画像は使わない（写っていたら作り直すか、生成をやめて仮素材にする）。
- 生成した画像は開いて全部見る。ratio と合わない、不自然なものは作り直す（1枚につき2回まで）。
- 生成に使ったプロンプトを `jobs/<id>/assets/gen/prompts.md` に残す。
- 画像生成のツールが使えなければ飛ばし、progress.md に「生成画像なし（仮素材で仮置き）」と書く。

## 2. 探索 — dynamic workflow として実行する
**この手順は dynamic workflow（勝ち抜き戦の型）として実行する。** workflow が使えない環境では、同じことを並列のサブエージェント呼び出しで行う。

1. **並列展開**：directions.md の方向性ごとに designer サブエージェントを並列に起動する。指示は「探索モード。方向性 dN を作る」。各自 `jobs/<id>/explore/dN/` にだけ書くので衝突しない。
2. **撮影**：方向性ごとに `node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --job jobs/<id> --from explore/dN --only key --out shots/explore-r01/dN`。
3. **方向性ごとに Artifact で公開**：人間が3案を見比べられるよう、方向性ごとに別の Artifact を publish する（`artifact-design` スキルを読んでから）。
   - `jobs/<id>/explore/dN.html` に一覧ページを書く：方向性 dN の名前と狙い（directions.md から）、`explore/dN/<…>/index.html` への相対リンク。
   - publish：`file_path` は `jobs/<id>/explore/dN.html`、`root` は `jobs/<id>`、`files` には `explore/dN/` 以下の全ファイルと参照している `assets/` のファイルを、案件フォルダからの相対パスのまま載せる。`icon` は `layout`、`description` は「<案件名> 探索 rNN dN：<方向性名>」。
   - URL を `jobs/<id>/artifact.json` の `explore.rNN.dN` に書く（`explore/` は git に入らないので URL はここに残す）。r02 では新しい方向性なので新しい Artifact を作る。
   - Artifact ツールが使えなければ飛ばし、progress.md に書く。
4. **勝ち抜き戦**：judge サブエージェントを呼び、`shots/explore-r01/` を比べさせる。出力を `jobs/<id>/verdicts/explore-r01.md` に保存する。
5. **最初の数件は人間が選ぶ**：完了した案件（`jobs/*/summary.json` があるもの）が `studio/config.json` の `defaults.human_pick_first`（なければ 5）より少なく、依頼者がこの会話にいる（スケジュールタスクや Slack の取り込みで始まった案件ではない）ときは、ここで止まって依頼者に選んでもらう。
   - 見せるもの：方向性ごとの Artifact の URL と名前、judge の RANKING と決め手（1行ずつ）。
   - 聞くこと：「どれで進めるか（d1〜d3、または全部だめ）と、言えれば一言の理由」。
   - 答えを `jobs/<id>/verdicts/explore-rNN-human.md` に書く：1行目 `PICK: dN`（全部だめなら `PICK: RETRY`）、2行目 `OTHERS: dX dY`、3行目 `REASON: <依頼者の言葉のまま>`。librarian が、レビューのときにこれを二択の記録に積む。
   - 依頼者の選択が judge と違っても依頼者に従う。`PICK: RETRY` なら 6 へ。
   - 条件に当てはまらないときは、judge の判定で進める。
6. RETRY なら、judge（または依頼者）の指示を添えて director に directions.md を作り直させ、1〜5 をもう1回だけ行う（r02）。2回目は RETRY でも RANKING の1位（人間が選ぶ回なら依頼者の選んだ案）を採る。
7. 勝者の `explore/<dN>/` の中身を `jobs/<id>/work/` にコピーし、`progress.md` に採用理由を1行書く。

## 3. 磨き — ここから先は関門 hook が回す
1. `.loop/state.json` の status を `"running"` にする。
2. designer サブエージェントを呼ぶ。指示は「展開モード。方向性 <dN> を全成果物に展開する。judge の『勝者を磨くときの指示』（verdicts/explore-rNN.md）も反映する」。
3. designer が終わったら、2行で要約してターンを終える。**止まると関門 hook が撮影・機械チェック・採点をし、不合格なら reason に次の指示を書いて差し戻す。** reason の指示に従い、自分で合否を判断しない。

hook が出す指示は次のどれか：
- 「designer を呼んで修正」→ 新しい designer サブエージェントに `verdicts/` の最新を直させる
- 「figma-builder を呼ぶ」→ figma-builder サブエージェントを呼ぶ
- 「figma-critic を呼んで <パス> に書かせる」→ figma-critic サブエージェントを呼び、そのパスに判定を書かせる
- 「納品」→ 下の 4 へ

## 4. 納品
1. **プレビューを Claude Artifact で公開する**（Vercel は使わない）。人間はこの URL でモックを開き、プロトタイプを触ってレビューする。
   - `artifact-design` スキルを読んでから、`jobs/<id>/preview.html` に一覧ページを書く：案件名、brief の一文要約、`manifest.json` の成果物ごとに `work/<…>/index.html` への相対リンクとサイズ。成果物の HTML 本体は手を加えずそのまま載せる。
   - Artifact ツールで publish する：`file_path` は `jobs/<id>/preview.html`、`root` は `jobs/<id>`、`files` には `work/` 以下の全ファイルと、成果物が参照する `assets/` のファイルを、案件フォルダからの相対パスのまま載せる（例：`{"work/lp/index.html": "work/lp/index.html", "assets/hero.jpg": "assets/hero.jpg"}`）。`icon` は `layout`、`description` は案件名と媒体。
   - 返ってきた URL を `jobs/<id>/artifact.json` の `url` と `published`（探索の `explore` はそのまま残す。例：`{ "url": "<URL>", "published": "YYYY-MM-DD", "explore": { "r01": { "d1": "<URL>", "d2": "<URL>", "d3": "<URL>" } } }`）と `progress.md` に書く。修正回はこの URL を更新し、新しい URL を作らない。
   - Artifact は最初は非公開。他の人に見せるときは持ち主が claude.ai で共有する、と PR に書く。
   - Artifact ツールが使えない環境では公開を飛ばし、PR のプレビュー欄に「Artifact 未公開（この環境で使えなかった）」と書いて、人間への質問にも回す。
2. 案件フォルダをコミットし、ブランチを push して PR を作る。PR タイトルは `design: <案件名>`。本文は次の形：

```
## <案件名>
媒体：<medium> ／ 成果物：<n> 点

| 工程 | 結果 |
|---|---|
| 探索 | <採用した方向性 dN（名前）>。他案：<…>。各案の Artifact：d1 <URL> ／ d2 <URL> ／ d3 <URL> |
| HTML | <scores>（<n> 回目で合格） |
| ユーザーテスト | <tasks / blockers>（対象外なら「なし」） |
| Figma | <scores>（<url>、00 Review から見る） |
| プレビュー | <Artifact の URL>（非公開。共有は claude.ai から） |

## 見てほしいところ
- 人間への質問：（progress.md から）
- 未確定事項：（contract.md から）
- 要コピー：（`shots/final/index.md` の「要コピー」から。どの成果物のどこか）
- 差し替えてほしい仮のコピー・仮の画像：（同じく「仮の画像」「仮のコピー」から）

## スクショ
（jobs/<id>/shots/final/ の画像を並べる）

## レビューのしかた
気になる点をコメントして `feedback` ラベルを付けると、修正と学習が自動で回ります。良ければそのままマージ。
```

3. Slack コネクタがあり `studio/config.json` の notify.slack_channel が空でなければ、PR と Artifact の URL、結果の表を送る（mention があれば付ける）。
4. ターンを終える。hook が状態を done にする。
