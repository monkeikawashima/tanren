---
name: design-job
description: デザインの依頼を受けたら必ず使う。バナー、LP、Webサイト、アプリ画面、UI、プロトタイプ、モック、サイトのリニューアル、SNS画像、OGP、サムネイル、チラシ、ポスター、名刺、スライド、HTMLメール、図解、モーション、ロゴ、アイコンなど。「作って」「デザインして」「モックを作って」「リニューアルして」「案を出して」と頼まれたとき。依頼から方向性の探索、制作、採点、Figma 書き出し、PR 作成まで自動で回す。
---

# design-job — 依頼から PR まで

サブエージェントは `tanren:<名前>`（例：`tanren:director`）で呼ぶ。このリポジトリに `studio/config.json` がなければ、先に `studio-init` スキルで準備する。

依頼者がやるのは依頼文を書くことと、最後のレビューだけ。途中で質問して止まらない（例外は、最初に仮の画像の扱いを聞く「0. 案件を作る」の 3、最初の数件で方向性を選んでもらう「2. 探索」の 5、0 の 1 でブランチを作れないときだけ）。分からないことは仮で決めて、最後に質問として返す。

## フォルダの形
1件の依頼 = 1フォルダ = 1ブランチ = 1 PR。依頼の中で、媒体ごとにフォルダを分ける。

```text
jobs/<id>/              依頼フォルダ：brief.md（依頼全体）、preview.html、delivery.json、summary.json
├─ lp/                  媒体フォルダ：brief.md（この媒体の分）、contract.md、manifest.json、tokens.json、
└─ banner/                           images.json、directions.md、assets/、explore/、work/、verdicts/、shots/、progress.md
```

- 媒体フォルダの名前は媒体名（`${CLAUDE_PLUGIN_ROOT}/studio/media.md` の名前）。同じ媒体が2つあれば `banner-2` のように番号を付ける。媒体が1つだけの依頼も、媒体フォルダを1つ作る。
- 以下で `<part>` と書くのは媒体フォルダ（例：`jobs/<id>/lp`）。スタッフの手順書と house-rules で「`jobs/<id>/`」と書いてあるところも、媒体フォルダを指す。サブエージェントを呼ぶときは、媒体フォルダのパスを渡す。

## 0. 案件を作る
1. 案件 id を `YYYYMMDD-<英語の短い slug>` で決め、`jobs/<id>/` を作る。
   - **ブランチ**：既定のブランチ（`git symbolic-ref --short refs/remotes/origin/HEAD`、なければ `main`）の最新から `design/<id>` を作って切り替える（`git switch -c design/<id> origin/<既定のブランチ>`。リモートがなければ今の既定のブランチから）。1件 = 1ブランチ = 1 PR なので、この依頼を受けたこと自体がブランチを作る依頼にあたる。
   - 利用者の指示でブランチを作ることが禁じられているなど、作れない事情があるときだけ、ここで一度だけ依頼者に確認する。作らずに既定のブランチのまま進めない（関門 hook が差し戻す）。
   - git のリポジトリでないとき、または `studio/config.json` の `defaults.git` が `false` のときは、ブランチも PR も作らず、`.loop/state.json` に `"git": false` を書いて進める（納品は 4 の「ローカル納品」）。
   - git でも GitHub のリモートがない（リモートなし、GitLab など）ときは、ブランチは作るが push と PR はしない（納品は 4 の「ローカル納品」。案件のブランチは持ち主が手元でマージする）。
2. `${CLAUDE_PLUGIN_ROOT}/studio/brief-template.md` を `jobs/<id>/brief.md` にコピーし、依頼文から埋める。依頼文にないことは「未記入」のまま残す（ここで推測を書かない）。`studio/taste/references/good/` が空で `rules.md` に箇条もなければ、止まらずに進め、依頼者への質問に「審美眼が空のため、好みを反映できていない。`/tanren:studio-init` の審美眼の種まきを勧める」と書く。
3. **仮の画像の扱いを聞く**：brief の「仮の画像」が「未記入」で、依頼者がこの会話にいる（スケジュールタスクや Slack の取り込みで始まった案件ではない）ときは、ここで一度だけ聞く。0 の 1 でブランチのことを聞くなら、同じ質問にまとめる。
   - 聞くこと：「モックの中で、支給素材がない画像の場所をどう仮置きするか」。選択肢は「生成アート（おすすめ）：色面と線画を貼り合わせた抽象の絵を、場所ごとに重ならないように作って敷く」と「グレー：用途と比率を書いた無地の面」。
   - 答えを依頼全体の brief の「仮の画像」に書く。依頼者がいないとき、または答えがないときは、`studio/config.json` の `defaults.placeholder`（`art` なら生成アート、`gray` ならグレー。なければ生成アート）を書き、progress.md に「仮の画像は設定の既定で〇〇」と書く。
   - どちらでも、依頼者の商品・店舗・ロゴ・実在の人物が要る場所は支給素材を待つ（生成アートは何も写っていない抽象の絵なので、仮置きには使ってよい）。
4. 依頼に含まれる媒体を `${CLAUDE_PLUGIN_ROOT}/studio/media.md` の一覧から選ぶ（例：LP とバナー一式なら `web` と `banner`。既存サイトの URL があって作り直しなら `renewal`）。媒体ごとに媒体フォルダ `<part>` を作り、次を置く：
   - `<part>/brief.md`：依頼全体の brief から、この媒体の分（サイズ、点数、文言、媒体固有の条件）を抜き出したもの。共通の部分（目的・対象・トーン）はそのまま写す。
   - 添付やリンク先の素材は `<part>/assets/`、参考画像は `<part>/references/` に置く（複数の媒体で使う素材は、それぞれにコピーする。プレビューを媒体フォルダごとに公開できるようにするため）。
5. リニューアルなら `node ${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs --job <part> --url <URL>` で棚卸しする（環境のネットワーク設定で対象ドメインが許可されている必要がある。失敗したら依頼者への質問に回し、URL なしで進める）。
6. **デザインシステム**：媒体ごとに使うものを決めて、媒体フォルダに写す。
   - 名前を決める：`node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium>`。brief の「デザインシステム」欄に名前（または「なし」）があれば `--override <名前>`（「なし」は `none`）を付ける。
   - `unset`（未設定）：デザインシステムなしで進め、依頼者への質問に「デザインシステムが未設定。`/tanren:design-system` で決められる」と書く。
   - `none`：デザインシステムなしで進める。
   - 名前が出たら：その名前と `extends` の土台のうち、版を確かめられる取り込み元（Claude の Design System・Figma・コード）の今の版を `studio/design-system/<名前>/source.json` と比べ、変わっていれば `design-system-import` スキルの「更新するとき」で取り直す。取り直したら、progress.md と依頼者への質問に「デザインシステムが更新されていたので取り直した」と書く。確かめられない環境なら、今の写しで進める。
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --resolve <名前> --out <part>/assets/ds` で、土台と重ねた1つのデザインシステムを媒体フォルダに写す。成果物はここを相対パスで読む（`assets/ds/tokens.css`、フォント、ロゴ。Artifact のプレビューに一緒に載せるため）。案件はこの写しを最後まで使う（途中で設定が変わっても見た目は変わらない）。
   - 使った名前を `<part>/brief.md` の「デザインシステム」欄と `<part>/progress.md` に書き、`assets/ds/README.md` の「推定の値」にあるものは依頼者への質問に載せる。
7. `.loop/state.json` を書く（数値は `studio/config.json` の defaults）。`parts` は媒体を磨く順（画面の多いもの → 少ないもの）。`job` と `medium` は最初の媒体：

```json
{ "status": "planning", "request": "jobs/<id>", "job": "jobs/<id>/<最初の媒体>", "medium": "<最初の媒体>",
  "parts": [ { "path": "jobs/<id>/lp", "medium": "web" }, { "path": "jobs/<id>/banner", "medium": "banner" } ],
  "current": 0, "phase": "build", "branch": "design/<id>", "pass_score": 8,
  "build": { "iteration": 0, "max": 10 }, "usertest": { "iteration": 0, "max": 3 },
  "figma": { "enabled": true, "iteration": 0, "max": 5 } }
```
Figma コネクタがこのセッションで使えないなら `figma.enabled` を false にし、依頼者への質問に「Figma 未接続」と書く。

## 1. ディレクション
媒体ごとに director サブエージェントを呼ぶ（媒体が複数なら1つのメッセージで同時に）。渡すのは媒体フォルダのパスと、依頼全体の `jobs/<id>/brief.md`（媒体どうしでトーンをそろえるため）。各 `<part>` に `contract.md`、`manifest.json`、`tokens.json`、`images.json`、`directions.md`（リニューアルなら `renewal/audit.md` と `renewal/ia.md` も）ができたことを確かめる。

### 1.5 仮の画像
媒体フォルダごとに、まず `${CLAUDE_PLUGIN_ROOT}/placeholders/placeholders.css` を `<part>/assets/placeholders/` にコピーする（画像がそろわない所は、designer がこの仮素材で仮置きする）。
brief の「仮の画像」が「生成アート」なら、続けて `node ${CLAUDE_PLUGIN_ROOT}/scripts/placeholder-art.mjs --part <part>` を実行する。`<part>/images.json` の画像ごとに `<part>/assets/placeholders/art/<id>.svg` ができる（同じ媒体の中では構図・色・模様が重ならない）。できた絵は開いて見る。
そのうえで、画像生成のツール（例：nano-banana の `generate_image`）がこのセッションで使えるなら、`<part>/images.json` の `"generate": true` の画像を生成し、`<part>/assets/gen/<id>.png` に保存する。
- `prompt` に書かれた情景・雰囲気だけを生成する。文字・ロゴ・実在の人物や商品が写った画像は使わない（写っていたら作り直すか、生成をやめて仮素材にする）。
- 生成した画像は開いて全部見る。ratio と合わない、不自然なものは作り直す（1枚につき2回まで）。
- 生成に使ったプロンプトを `<part>/assets/gen/prompts.md` に残す。
- 画像生成のツールが使えなければ飛ばし、progress.md に「生成画像なし（仮素材で仮置き）」と書く。

## 2. 探索
全部の媒体の探索を先に済ませてから、3 の磨きに入る。1〜3 は並列に回す。
- **既定**：Agent ツールで、全媒体 × 全方向性の designer を1つのメッセージで同時に呼ぶ。全員が終わってから 2 の撮影と 3 の judge を行う（judge も媒体ごとに1つのメッセージで同時に呼ぶ）。
- **Workflow ツール（dynamic workflows）を使うのは、依頼者がこのセッションで ultracode やワークフローの利用をはっきり求めているとき（`/effort ultracode` を含む）だけ。** そのときは全媒体の 1〜3 を1つの workflow にする（媒体 × 方向性ごとに designer → 撮影を pipeline で流し、媒体ごとに全部そろってから judge）。skill の指示だけを理由に Workflow を使わない（実行の確認で止まり、「途中で質問して止まらない」に反するため）。
- 4 から先は、並列の作業が全部終わってからこの会話で行う（Artifact の公開と依頼者への質問は、workflow やサブエージェントの中ではできないため）。

1. **並列展開**：各 `<part>/directions.md` の方向性ごとに designer サブエージェントを並列に起動する。指示は「探索モード。<part> の方向性 dN を作る」。各自 `<part>/explore/dN/` にだけ書くので衝突しない。
2. **撮影**：方向性ごとに `node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --job <part> --from explore/dN --only key --out shots/explore-r01/dN`。
3. **勝ち抜き戦**：媒体ごとに judge サブエージェントを呼び、`<part>/shots/explore-r01/` を比べさせる。出力を `<part>/verdicts/explore-r01.md` に保存する。
4. **方向性ごとに Artifact で公開**：人間が3案を見比べられるよう、媒体 × 方向性ごとに別の Artifact を publish する（`artifact-design` スキルを読んでから）。
   - 一覧ページは **媒体フォルダの直下** に `<part>/explore-rNN-dN.html` として書く（`explore/` の中に置かない。Artifact は一覧ページを公開物のいちばん上に置くので、下のフォルダに置くと中のリンクがずれて「This content is unavailable」になる）。中身は媒体名、方向性 dN の名前と狙い（directions.md から）、`explore/dN/<…>/index.html` への相対リンク（媒体フォルダから見たパス）。
   - 公開するファイルを集めて確かめる：`node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-files.mjs --root <part> --page <part>/explore-rNN-dN.html`。リンク切れや root の外への参照があれば一覧が出て止まるので、直してからもう一度実行する。通ったら出力の `file_path`・`root`・`files` をそのまま publish に渡す（`files` を手で書かない）。`icon` は `layout`、`description` は「<案件名> <媒体> 探索 rNN dN：<方向性名>」。
   - URL を `<part>/artifact.json` の `explore.rNN.dN` に書く（`explore/` は git に入らないので URL はここに残す）。r02 では新しい方向性なので新しい Artifact を作る。
   - Artifact ツールが使えなければ飛ばし、progress.md に書く。
5. **最初の数件は人間が選ぶ**：納品まで進んだ依頼（`jobs/*/summary.json` があるもの）が `studio/config.json` の `defaults.human_pick_first`（なければ 5）より少なく、依頼者がこの会話にいる（スケジュールタスクや Slack の取り込みで始まった案件ではない）ときは、ここで止まって依頼者に選んでもらう。媒体が複数でも、聞くのは1回にまとめる。
   - 見せるもの：媒体ごとに、方向性ごとの Artifact の URL と名前、judge の RANKING と決め手（1行ずつ）。
   - 聞くこと：「媒体ごとに、どれで進めるか（d1〜d3、または全部だめ）と、言えれば一言の理由」。
   - 答えを媒体ごとに `<part>/verdicts/explore-rNN-human.md` に書く：1行目 `PICK: dN`（全部だめなら `PICK: RETRY`）、2行目 `OTHERS: dX dY`、3行目 `REASON: <依頼者の言葉のまま>`。librarian が、レビューのときにこれを二択の記録に積む。
   - 依頼者の選択が judge と違っても依頼者に従う。`PICK: RETRY` の媒体は 6 へ。
   - 条件に当てはまらないときは、judge の判定で進める。
6. RETRY の媒体は、judge（または依頼者）の指示を添えて director に directions.md を作り直させ、その媒体だけ 1〜5 をもう1回だけ行う（r02）。2回目は RETRY でも RANKING の1位（人間が選ぶ回なら依頼者の選んだ案）を採る。
7. 媒体ごとに、勝者の `<part>/explore/<dN>/` の中身を `<part>/work/` にコピーし、`<part>/progress.md` に採用理由を1行書く。

## 3. 磨き — ここから先は関門 hook が回す
1. `.loop/state.json` の status を `"running"` にする。
2. 媒体ごとに designer サブエージェントを呼ぶ（1つのメッセージで同時に）。指示は「展開モード。<part> の方向性 <dN> を全成果物に展開する。judge の『勝者を磨くときの指示』（<part>/verdicts/explore-rNN.md）も反映する」。
3. designer が全員終わったら、2行で要約してターンを終える。**止まると関門 hook が、`parts` の順に媒体を1つずつ撮影・機械チェック・採点し、不合格なら reason に次の指示を書いて差し戻す。** 1つの媒体が終わると（合格でも上限でも）次の媒体に移り、全部の媒体が終わってから1回だけ納品に進む。reason の指示に従い、自分で合否を判断しない。

hook が出す指示は次のどれか：
- 「designer を呼んで修正」→ 新しい designer サブエージェントに `verdicts/` の最新を直させる
- 「figma-builder を呼ぶ」→ figma-builder サブエージェントを呼ぶ
- 「figma-critic を呼んで <パス> に書かせる」→ figma-critic サブエージェントを呼び、そのパスに判定を書かせる
- 「ブランチを切り替える」→ 0 の 1 のブランチに切り替える
- 「撮影に失敗」→ `manifest.json` と HTML を直す（3回続くと、hook がその媒体を打ち切って次へ進む）
- 「関門 hook がエラー」→ `.loop/state.json` と案件フォルダを確かめて直す（3回続くと、hook が打ち切る）
- 「次は <媒体> を採点します」→ その媒体の `work/` が空なら designer に展開させ、展開済みなら何も変えずにターンを終える
- 「納品」→ 下の 4 へ
- 「PR を確認できない」→ 4 の 2 をやり直す
- 「PR を作りません」「納品の報告を確認できない」→ 4 の「ローカル納品」

## 4. 納品
1. **プレビューを Claude Artifact で公開する**（Vercel は使わない）。人間はこの URL でモックを開き、プロトタイプを触ってレビューする。
   - `artifact-design` スキルを読んでから、`jobs/<id>/preview.html` に一覧ページを書く：案件名、brief の一文要約、媒体ごとの見出しと、その媒体の `manifest.json` の成果物ごとに `<媒体>/work/<…>/index.html` への相対リンクとサイズ。成果物の HTML 本体は手を加えずそのまま載せる。
   - 公開するファイルを集めて確かめる：`node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-files.mjs --root jobs/<id> --page jobs/<id>/preview.html`。止まったらリンク切れを直してやり直し、通ったら出力の `file_path`・`root`・`files` をそのまま Artifact ツールの publish に渡す（`files` を手で書かない。中身は各媒体の `work/` と、成果物が参照する `assets/` のファイル。例：`{"lp/work/top/index.html": "lp/work/top/index.html", "lp/assets/hero.jpg": "lp/assets/hero.jpg", "banner/work/300x250/index.html": "banner/work/300x250/index.html"}`）。`icon` は `layout`、`description` は案件名と媒体。
   - 返ってきた URL を `jobs/<id>/artifact.json` の `url` と `published`（探索の `explore` はそのまま残す。例：`{ "url": "<URL>", "published": "YYYY-MM-DD", "explore": { "r01": { "d1": "<URL>", "d2": "<URL>", "d3": "<URL>" } } }`）と `progress.md` に書く。修正回はこの URL を更新し、新しい URL を作らない。
   - Artifact は最初は非公開。他の人に見せるときは持ち主が claude.ai で共有する、と PR に書く。
   - Artifact ツールが使えない環境では公開を飛ばし、PR のプレビュー欄に「Artifact 未公開（この環境で使えなかった）」と書いて、人間への質問にも回す。
2. 依頼フォルダをコミットし、ブランチを push して PR を1つ作る（媒体が複数でも PR は1つ）。
   - コマンド：`git push -u origin <ブランチ>`、`gh pr create --base <既定のブランチ> --head <ブランチ> --title "design: <案件名>" --body-file <本文のファイル>`。gh がない環境（クラウドなど）では、使える GitHub のツールで同じ PR を作る。
   - 修正回（`jobs/<id>/delivery.json` に `pr` がある）は新しい PR を作らず、同じブランチに push して、PR にコメントで今回の結果を返す。
   - 作った（または更新した）PR の URL を `jobs/<id>/delivery.json` に `{ "pr": "<URL>", "branch": "<ブランチ>" }` で書く。次に止まったとき、関門 hook が PR があるか・最新の commit が push されているかを確かめ、なければ差し戻す（3回でも確かめられなければ「PR なし」として止まり、理由を通知する）。
   - push や PR の作成に失敗したら、黙ってターンを終えない。理由（gh が未ログイン、リモートがない、など）を progress.md に書き、依頼者への質問にも載せる。
   - PR タイトルは `design: <案件名>`。本文は次の形（hook が伝えた結果が「全工程に合格」以外なら、冒頭の注意書きを入れ、表の該当する行に「未合格（上限 n 回）」「採点エラーで打ち切り」「撮影できずに打ち切り」「未検品」をそのまま書く）：

```
> [!WARNING]
> 未合格の工程があります：<hook が伝えた結果と理由>（全工程に合格ならこの3行を消す）

## <案件名>
媒体：<medium>, <medium> ／ 成果物：<n> 点
プレビュー：<Artifact の URL>（非公開。共有は claude.ai から）
かかった時間：<summary.json の minutes> 分 ／ 採点の費用：$<summary.json の eval_cost_usd>（critic と user-tester の分）

### <媒体>（`jobs/<id>/<媒体>/`）
| 工程 | 結果 |
|---|---|
| 探索 | <採用した方向性 dN（名前）>。他案：<…>。各案の Artifact：d1 <URL> ／ d2 <URL> ／ d3 <URL> |
| HTML | <scores>（<n> 回目で合格 ／ 未合格：上限 <n> 回。点数が一番高かった回に戻したときは「build NN の版を納品」） |
| ユーザーテスト | <tasks / blockers>（対象外なら「なし」、上限なら「未合格：上限 <n> 回」） |
| Figma | <scores>（<url>、00 Review から見る。未接続・未検品ならそう書く） |

（媒体ごとに「### <媒体>」と表を繰り返す）

## 見てほしいところ
- 人間への質問：（各媒体の progress.md から。どの媒体の話かを書く）
- 未確定事項：（各媒体の contract.md から）
- 要コピー：（各媒体の `shots/final/index.md` の「要コピー」から。どの媒体の、どの成果物のどこか）
- 差し替えてほしい仮のコピー・仮の画像：（同じく「仮の画像」「仮のコピー」から）

## スクショ
（媒体ごとに、jobs/<id>/<媒体>/shots/final/ の画像を並べる）

## レビューのしかた
気になる点を PR にコメントしたら、Claude Code で「この PR の指摘を直して」と頼むと、修正と学習が回ります。クラウドの Project でスケジュールタスク studio-feedback を設定していれば、`feedback` ラベルを付けるだけで自動で回ります。良ければそのままマージ。
```

3. Slack コネクタがあり `studio/config.json` の notify.slack_channel が空でなければ、PR と Artifact の URL、結果の表を送る（mention があれば付ける）。
4. ターンを終える。hook が PR（ローカル納品なら報告）を確かめてから、状態を done にする。

### ローカル納品（PR を作らないとき）
`studio/config.json` の `defaults.delivery` が `local` のとき、git のリポジトリでないとき、git のリモートがないときは、hook が「PR を作りません」と伝える。そのときは上の 2 の代わりに次を行う（1 の Artifact、3 の Slack（PR の URL の代わりに報告のパス）、4 はそのまま）。
- push も PR の作成もしない。案件のブランチは手元に残す（持ち主が手元で既定のブランチにマージする）。
- 2 の PR 本文と同じ形の報告を `jobs/<id>/delivery.md` に書く。タイトルは `# design: <案件名>`。「レビューのしかた」の節だけ次に置き換える：

```
## レビューのしかた
直してほしいところは、Claude Code のチャットでそのまま伝えてください。修正が回り、この報告が書き直されます。
このままで良ければ、チャットで「<案件ID> はこれで OK」のように伝えてください（手直しなしの承認として記録されます）。案件のブランチ `<ブランチ>` は、手元で既定のブランチにマージしてください。
```

- `jobs/<id>/delivery.json` に `{ "local": "jobs/<id>/delivery.md", "branch": "<ブランチ>" }` を書く（git でなければ `branch` は書かない）。
- 修正回も同じ `delivery.md` を今回の結果で書き直す（hook は、納品に入ってから書き直されたかを確かめる。3回でも確かめられなければ「報告なし」として止まり、理由を通知する）。
- 依頼者には、報告のパスとプレビューの URL を伝えてからターンを終える。
