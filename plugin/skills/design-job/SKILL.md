---
name: design-job
description: デザインの依頼を受けたら必ず使う。バナー、LP、Webサイト、アプリ画面、UI、プロトタイプ、モック、サイトのリニューアル、SNS画像、OGP、サムネイル、チラシ、ポスター、名刺、スライド、HTMLメール、図解、モーション、ロゴ、アイコンなど。「作って」「デザインして」「モックを作って」「リニューアルして」「案を出して」と頼まれたとき。最初に選択式でまとめて聞き、探索・上位案の並列の磨き・採点・ユーザーテストまで止まらずに回し、最後に選択式で仕上げ（Figma 書き出しなど）を選んでもらって納品する。
---

# design-job — 依頼から納品まで

サブエージェントは `tanren:<名前>`（例：`tanren:director`）で呼ぶ。このリポジトリに `studio/config.json` がなければ、先に `studio-init` スキルで準備する。

**依頼者が手を動かすのは最初と最後の2回だけ。** 最初に必要な判断をまとめて選択式で聞き（0 の 5）、そこから最後の確認（4）までは途中で質問して止まらない。分からないことは仮で決めて、最後の確認の選択肢にする。最後の確認の答えは審美眼と検証セットに積み、案件を重ねるほど審査が依頼者の好みに近づく（近づいたら、磨く案の数を自動で減らす）。

並列にできるところは並列にする。サブエージェントを呼ぶ指示が複数あれば、1つのメッセージで同時に呼ぶ。

## フォルダの形
1件の依頼 = 1フォルダ = 1ブランチ = 1 PR。依頼の中で、媒体ごとにフォルダを分ける。

```text
jobs/<id>/              依頼フォルダ：brief.md（依頼全体）、review.html、preview.html、delivery.json、summary.json
├─ lp/                  媒体フォルダ（探索の場所）：brief.md、contract.md、manifest.json、tokens.json、images.json、
│                         directions.md、assets/、references/、explore/、verdicts/、shots/、progress.md
├─ lp-d3/               レーン：上位案ごとの磨きの場所（媒体フォルダの写し＋work/。上位案を1つだけ磨くときは作らず lp/ で磨く）
├─ lp-d1/
└─ banner/
```

- 媒体フォルダの名前は媒体名（`${CLAUDE_PLUGIN_ROOT}/studio/media.md` の名前）。同じ媒体が2つあれば `banner-2` のように番号を付ける。媒体が1つだけの依頼も、媒体フォルダを1つ作る。
- 以下で `<part>` と書くのは媒体フォルダ（例：`jobs/<id>/lp`）、`<lane>` はレーンのフォルダ（例：`jobs/<id>/lp-d3`）。スタッフの手順書と house-rules で「`jobs/<id>/`」と書いてあるところは、媒体フォルダかレーンのフォルダを指す。サブエージェントを呼ぶときは、そのフォルダのパスを渡す。
- レーンは `node ${CLAUDE_PLUGIN_ROOT}/scripts/lanes.mjs` が作る・閉じる。手で写さない。

## 0. 案件を作る
1. 案件 id を `YYYYMMDD-<英語の短い slug>` で決め、`jobs/<id>/` を作る。
   - **ブランチ**：既定のブランチ（`git symbolic-ref --short refs/remotes/origin/HEAD`、なければ `main`）の最新から `design/<id>` を作って切り替える（`git switch -c design/<id> origin/<既定のブランチ>`。リモートがなければ今の既定のブランチから）。1件 = 1ブランチ = 1 PR なので、この依頼を受けたこと自体がブランチを作る依頼にあたる。
   - 利用者の指示でブランチを作ることが禁じられているなど、作れない事情があるときは、5 の質問に「ブランチの扱い」を1問足す。作らずに既定のブランチのまま進めない（関門 hook が差し戻す）。
   - git のリポジトリでないとき、または `studio/config.json` の `defaults.git` が `false` のときは、ブランチも PR も作らず、`.loop/state.json` に `"git": false` を書いて進める（納品は 5 の「ローカル納品」）。
   - git でも GitHub のリモートがない（リモートなし、GitLab など）ときは、ブランチは作るが push と PR はしない（納品は 5 の「ローカル納品」。案件のブランチは持ち主が手元でマージする）。
2. `${CLAUDE_PLUGIN_ROOT}/studio/brief-template.md` を `jobs/<id>/brief.md` にコピーし、依頼文から埋める。依頼文にないことは「未記入」のまま残す（ここで推測を書かない）。`studio/taste/references/good/` が空で `rules.md` に箇条もなければ、止まらずに進め、最後の確認の質問に「審美眼が空のため、好みを反映できていない。`/tanren:studio-init` の審美眼の種まきを勧める」と書く。
3. 依頼に含まれる媒体を `${CLAUDE_PLUGIN_ROOT}/studio/media.md` の一覧から選び（例：LP とバナー一式なら `web` と `banner`。既存サイトの URL があって作り直しなら `renewal`）、媒体ごとに媒体フォルダ `<part>` を作る：
   - `<part>/brief.md`：依頼全体の brief から、この媒体の分（サイズ、点数、文言、媒体固有の条件）を抜き出したもの。共通の部分（目的・対象・トーン）はそのまま写す。
   - 添付やリンク先の素材は `<part>/assets/`、参考画像は `<part>/references/` に置く（複数の媒体で使う素材は、それぞれにコピーする）。
4. **参考サイトの素材と事実を集める**（依頼文や brief に URL があるとき。5 の質問と同時に、並列で走らせてよい）：
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/brand-assets.mjs --url <URL> --out <part>/references/site`。全文（`text.txt`）、ファーストビューと全体のスクショ、書体と色（`style.json`）、ロゴ、キャラクター・図などページ固有の絵（`graphics/`）が `index.md` 付きでそろう。`graphics/` の絵は開いて見る。
   - 依頼者自身のサイトなら、ロゴとキャラクターは支給素材として `<part>/assets/brand/` に写し、brief の「既存のブランド資産」に書く。最初からブランドの絵が使えると、「本家の縮小版に見える」まま磨きが止まるのを防げる。他社のサイトなら参考にだけ使い、成果物に載せない。
   - コピーと事実の出典は `text.txt` にあるものだけにし、brief の「使ってよい文言・事実」に出典として書く。
   - リニューアルなら、加えて `node ${CLAUDE_PLUGIN_ROOT}/scripts/crawl.mjs --job <part> --url <URL>` で棚卸しする。
   - どちらも、環境のネットワーク設定で対象ドメインが許可されている必要がある。失敗したら URL なしで進め、最後の確認に回す。
5. **最初にまとめて聞く**（AskUserQuestion を1回。依頼者がこの会話にいるときだけ。スケジュールタスクや Slack の取り込みで始まった案件では聞かず、下の既定で決めて progress.md に書く）。
   - 聞くのは、答えで成果物が大きく変わるのに brief で「未記入」のもの。多くても4問で、依頼文や設定で決まっているものは聞かない。各問に2〜4個の選択肢を、参考サイトの全文と brief から具体的に作る（「その他」は自動で付く）。おすすめを1番目に置き、ラベルの末尾に「（おすすめ）」と付ける。
   - 優先順：
     1. **誰に何をしてほしいか**：見る人と、見た後の行動（例：「新規事業の責任者 → LP 内のフォームから相談」）。
     2. **見た目の土台**：`node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium>` の結果と、参考サイトがあるかで選択肢を作る（例：「参考サイト（依頼者の既存サイト）に合わせる」「登録済みのデザインシステム <名前>」「director に任せる」）。デザインシステムが1つに決まっていて参考サイトもなければ聞かない。
     3. **磨く案の数**：`node ${CLAUDE_PLUGIN_ROOT}/scripts/lanes.mjs count` の結果をおすすめにする（例：「上位2案を並列で磨いて最後に選ぶ（おすすめ）」「審査の1位だけ磨く（速く安い）」「方向性を指定する」）。2案は時間はほぼ同じで、採点の費用が約2倍。
     4. **仮の画像**：支給素材がない場所の仮置きを「生成アート（おすすめ）：色面と線画を貼り合わせた抽象の絵を、場所ごとに重ならないように作って敷く」か「グレー：用途と比率を書いた無地の面」から。brief に書いてあれば聞かない。
     - 1〜4 のどれかが決まっていれば、空いた枠で brief の別の「未記入」（一番伝えたいこと、CTA の文言、出稿先、0 の 1 のブランチの扱いなど）を聞く。
   - 答えは brief の該当欄に書く（依頼者の言葉のまま）。聞かなかった項目と答えがなかった項目は、設定の既定（仮の画像は `defaults.placeholder`、磨く案の数は `lanes.mjs count`、見た目の土台はデザインシステムの割り当て）で決め、progress.md に「〇〇は既定で△△」と書く。
   - Figma への書き出しは、ここでは聞かない（最後の確認で、仕上げとして選んでもらう）。
6. **デザインシステム**：媒体ごとに使うものを決めて、媒体フォルダに写す。
   - 名前を決める：`node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium>`。brief の「デザインシステム」欄に名前（または「なし」）があれば `--override <名前>`（「なし」は `none`）を付ける。5 で「参考サイトに合わせる」「director に任せる」を選んだら `none`。
   - `unset`（未設定）：デザインシステムなしで進め、最後の確認に「デザインシステムが未設定。`/tanren:design-system` で決められる」と書く。
   - `none`：デザインシステムなしで進める。
   - 名前が出たら：その名前と `extends` の土台のうち、版を確かめられる取り込み元（Claude の Design System・Figma・コード）の今の版を `studio/design-system/<名前>/source.json` と比べ、変わっていれば `design-system-import` スキルの「更新するとき」で取り直す。取り直したら progress.md と最後の確認に書く。確かめられない環境なら、今の写しで進める。
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --resolve <名前> --out <part>/assets/ds` で、土台と重ねた1つのデザインシステムを媒体フォルダに写す。成果物はここを相対パスで読む。案件はこの写しを最後まで使う。
   - 使った名前を `<part>/brief.md` の「デザインシステム」欄と `<part>/progress.md` に書き、`assets/ds/README.md` の「推定の値」にあるものは最後の確認に載せる。
7. `.loop/state.json` に `{ "status": "planning", "request": "jobs/<id>", "branch": "design/<id>" }` を書く（git でなければ `"git": false` も）。磨きの状態は 3 で `lanes.mjs start` が書く。

## 1. ディレクション
媒体ごとに director サブエージェントを呼ぶ（媒体が複数なら1つのメッセージで同時に）。渡すのは媒体フォルダのパスと、依頼全体の `jobs/<id>/brief.md`（媒体どうしでトーンをそろえるため）、`<part>/references/site/index.md`（あれば）。方向性の数は `studio/config.json` の `defaults.directions`。各 `<part>` に `contract.md`、`manifest.json`、`tokens.json`、`images.json`、`directions.md`（リニューアルなら `renewal/audit.md` と `renewal/ia.md` も）ができたことを確かめる。

### 1.5 仮の画像
媒体フォルダごとに、まず `${CLAUDE_PLUGIN_ROOT}/placeholders/placeholders.css` を `<part>/assets/placeholders/` にコピーする（画像がそろわない所は、designer がこの仮素材で仮置きする）。
brief の「仮の画像」が「生成アート」なら、続けて `node ${CLAUDE_PLUGIN_ROOT}/scripts/placeholder-art.mjs --part <part>` を実行する。`<part>/images.json` の画像ごとに `<part>/assets/placeholders/art/<id>.svg` ができる（同じ媒体の中では構図・色・模様が重ならない）。できた絵は開いて見る。
そのうえで、画像生成のツール（例：nano-banana の `generate_image`）がこのセッションで使えるなら、`<part>/images.json` の `"generate": true` の画像を生成し、`<part>/assets/gen/<id>.png` に保存する。
- `prompt` に書かれた情景・雰囲気だけを生成する。文字・ロゴ・実在の人物や商品が写った画像は使わない（写っていたら作り直すか、生成をやめて仮素材にする）。
- 生成した画像は開いて全部見る。ratio と合わない、不自然なものは作り直す（1枚につき2回まで）。
- 生成に使ったプロンプトを `<part>/assets/gen/prompts.md` に残す。
- 画像生成のツールが使えなければ飛ばし、progress.md に「生成画像なし（仮素材で仮置き）」と書く。

## 2. 探索
全部の媒体の探索を先に済ませてから、3 の磨きに入る。
- **既定**：Agent ツールで、全媒体 × 全方向性の designer を1つのメッセージで同時に呼ぶ。全員が終わってから撮影と judge を行う（judge も媒体ごとに1つのメッセージで同時に呼ぶ）。
- **Workflow ツール（dynamic workflows）を使うのは、依頼者がこのセッションで ultracode やワークフローの利用をはっきり求めているとき（`/effort ultracode` を含む）だけ。** skill の指示だけを理由に Workflow を使わない（実行の確認で止まり、「途中で止まらない」に反するため）。
- 4 から先は、並列の作業が全部終わってからこの会話で行う（Artifact の公開と依頼者への質問は、workflow やサブエージェントの中ではできないため）。

1. **並列展開**：各 `<part>/directions.md` の方向性ごとに designer サブエージェントを並列に起動する。指示は「探索モード。<part> の方向性 dN を作る」。各自 `<part>/explore/dN/` にだけ書くので衝突しない。
2. **撮影**：方向性ごとに `node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --job <part> --from explore/dN --only key --out shots/explore-r01/dN`（方向性の数だけ同時に走らせてよい）。
3. **勝ち抜き戦**：媒体ごとに judge サブエージェントを呼び、`<part>/shots/explore-r01/` を比べさせる。出力を `<part>/verdicts/explore-r01.md` に保存する。
4. **RETRY**：judge が RETRY の媒体は、judge の指示を添えて director に directions.md を作り直させ、その媒体だけ 1〜3 をもう1回だけ行う（r02）。2回目は RETRY でも RANKING の上位を採る。
5. **磨く案を決める**：媒体ごとに、RANKING の上から「磨く案の数」（0 の 5 の答え。なければ `lanes.mjs count`）だけ採る。依頼者が方向性を指定していたら、その案を採る。ここでは依頼者に聞かない（探索の各案は、最後の確認のページで見られる）。

## 3. 磨き — ここから先は関門 hook が回す
1. レーンを作る：`node ${CLAUDE_PLUGIN_ROOT}/scripts/lanes.mjs start --request jobs/<id> --part <part>=<dA>,<dB> [--part <part2>=<dC>]`。採った案が1つの媒体は媒体フォルダそのもの、2つ以上なら `<part>-<dN>` がレーンになり、`explore/<dN>/` が `work/` に写る（相対パスの深さも直る）。`.loop/state.json` がレーンを束ねた形（status: running）になる。
2. 全レーンの designer サブエージェントを1つのメッセージで同時に呼ぶ。指示は「展開モード。<lane> の方向性 <dN> を全成果物に展開する。judge の判定（<lane>/verdicts/explore-rNN.md）の『勝者を磨くときの指示』（2位以下のレーンは『2位以下を磨くときの指示』）も反映する」。
3. designer が全員終わったら、2行で要約してターンを終える。**止まると関門 hook が、走っている全レーンを同時に撮影・機械チェック・採点し、レーンごとの指示を1つにまとめて返す。** 合格したレーンはユーザーテストに進み、終わると最後の確認の前で待つ。全レーンがそろうと hook が「4. 最後の確認」に進ませる。reason の指示に従い、自分で合否を判断しない。

hook が出すレーンごとの指示は次のどれか。全レーン分を1つのメッセージで同時に実行する：
- 「designer を呼んで修正」→ 新しい designer サブエージェントに `verdicts/` の最新を直させる。ただし下の「点が止まったら」に当たるときは2体で別解を作る
- 「撮影に失敗」→ そのレーンの `manifest.json` と HTML を直す（3回続くと、hook がそのレーンを打ち切る）
- 「関門 hook がエラー」「子プロセスが異常終了」→ `.loop/lanes/<レーン>.json` とレーンのフォルダを確かめて直す（3回続くと、hook が打ち切る）
- 「何も変更せずにすぐターンを終えて」（ユーザーテストに進むときなど）→ そのレーンには何もしない
- 「4. 最後の確認に進んで」→ 下の 4 へ

**点が止まったら（並列の別解）**：あるレーンで、最新の判定と1つ前の判定の SCORES が、合格点に届いていない同じ項目で同じ点のとき（例：design=6 が2回続いた）は、designer を1体ではなく2体、同時に呼ぶ。
1. `<lane>/work/` を `<lane>/alt/a/` と `<lane>/alt/b/` に写す。
2. 2体に同じ判定を渡す。a は「修正モード。<lane>/alt/a/ を work/ の代わりに直す。修正リストを上から全部」。b は「修正モード。<lane>/alt/b/ を work/ の代わりに直す。止まっている項目の原因（判定の『良い例との比較』と、その項目の所見）を、修正リストの範囲を超えて構成から作り直して解く」。どちらも撮影は `shoot.mjs --job <lane> --from alt/<x> --out shots/alt-<NN>/<x>`。
3. 2体が終わったら judge サブエージェントに `shots/alt-<NN>/a` と `b` を比べさせ（「探索の判定と同じ形式で、a と b のどちらが合格に近いか。止まっている項目を最優先」）、勝った方を `<lane>/work/` に写す。progress.md に「別解：a/b、採ったのは〇（理由）」と書き、`alt/` を消す。
4. 2行で要約してターンを終える（hook が採点する）。

## 4. 最後の確認（依頼者が答える2回目）
hook が「4. 最後の確認に進んで」と返したら（`.loop/state.json` の status は review になり、hook は止まっている）：

1. **確認のページを公開する**：`artifact-design` スキルを読んでから、`jobs/<id>/review.html` を書く。媒体ごとに、レーンを左右に並べる：方向性の名前と狙い（directions.md）、HTML とユーザーテストの結果（レーンの `summary.json`）、`<lane>/shots/final/` の 1440 と 375 の全体、`<lane>/work/<…>/index.html` へのリンク。下に、探索の全案（`<part>/shots/explore-rNN/dN/`）の小さなスクショと judge の RANKING、仮のコピー・仮の画像・未確定事項の一覧（各レーンの `shots/final/index.md`・`contract.md` の未確定事項・progress.md の人間への質問から）。`node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-files.mjs --root jobs/<id> --page jobs/<id>/review.html` で集め、出力をそのまま publish に渡す（`icon` は `layout`）。URL を `jobs/<id>/artifact.json` の `review` に書く。Artifact が使えなければ、各レーンの `shots/final/` の PNG を SendUserFile で送る。
2. **選択式で聞く**（AskUserQuestion を1回。問いは4つまで。足りないときだけ、続けてもう1回）。質問文に確認のページの URL を入れる。
   - **どれで仕上げるか**：媒体ごとに1問。選択肢はレーン（「d1 白い余白の相談の入口：HTML 8点・ユーザーテスト合格」のように1行で）と「どれもだめ（方向を変えて探索し直す）」。審査の1位に「（審査1位）」と付ける。
   - **決め手**（複数選択）：選んだ理由を、レーンどうしの実際の違いから選択肢にする（例：「余白の取り方」「見出しのコピー」「キャラクターの使い方」「ページの構成」）。審美眼に積む材料になる。
   - **仮のものの決め方**：一番影響の大きい仮のコピー・未確定事項を1問（例：h1 を「仮案のまま」「既存の〇〇に戻す」）。残りは「仮のまま納品し、報告に一覧で載せる」。
   - **仕上げ**（複数選択）：「Figma に書き出す」（`studio/config.json` の `figma.enabled` が true で、Figma コネクタが使えるときだけ出す）、「直してから仕上げる（直す内容を『その他』に書く）」、「このまま納品」。
   - 依頼者がこの会話にいないとき（スケジュールタスクなど）は、審査の1位で、仮のものは仮のまま、Figma なしで仕上げ、報告の冒頭に「最後の確認は未回答。審査の1位で納品した」と書く。
3. **答えを反映する**：
   - 「どれもだめ」の媒体：理由を添えて director に directions.md を作り直させ、その媒体だけ 2 と 3 をやり直す（r02）。終わったら、もう一度この 4 に来る（依頼者に3回目の質問をするのは、この場合だけ）。
   - 直しや仮のものの決定でページが変わるレーン：依頼者の言葉のまま `<lane>/verdicts/human-<NN>.md` に critic と同じ形式で書く（VERDICT: FAIL、修正リストに1件ずつ）。
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/lanes.mjs finish --request jobs/<id> --pick <選んだレーン>[,<他の媒体のレーン>] [--fix <直すレーン>,...] --figma on|off --reason "<決め手（依頼者の選んだ言葉のまま）>"`。選んだレーンが普通の状態（parts）に戻り、選ばなかったレーンは閉じる。審査の1位と依頼者の選択が一致したかが `studio/metrics/runs.jsonl` に積まれ（次からの「磨く案の数」に使う）、探索した媒体フォルダに `verdicts/explore-rNN-human.md` が書かれる。
   - **審美眼に積む**（並列で）：librarian サブエージェントを呼び、案件 id、選んだレーンと選ばなかったレーン、決め手、仮のものの決め方、`<part>/verdicts/explore-rNN-human.md` を渡す（design-feedback スキルの「記録」と同じ材料）。
   - 直すレーンがあれば、そのレーンの designer を同時に呼ぶ（「修正モード。<lane>/verdicts/human-<NN>.md を上から全部直す」）。
   - 2行で要約してターンを終える。hook が、直したレーンは採点とユーザーテストからやり直し、Figma を選んでいれば Figma へ、そうでなければ納品へ進める。**ここから完了までは依頼者に聞かない。**

hook が出す指示は次のどれか：
- 「designer を呼んで修正」→ 新しい designer サブエージェントに `verdicts/` の最新を直させる
- 「figma-builder を呼ぶ」→ figma-builder サブエージェントを呼ぶ
- 「figma-critic を呼んで <パス> に書かせる」→ figma-critic サブエージェントを呼び、そのパスに判定を書かせる
- 「ブランチを切り替える」→ 0 の 1 のブランチに切り替える
- 「撮影に失敗」→ `manifest.json` と HTML を直す
- 「次は <媒体> を採点します」→ 何も変えずにターンを終える（磨き終わったレーンは採点を飛ばして仕上げに進む）
- 「納品」→ 下の 5 へ
- 「PR を確認できない」→ 5 の 2 をやり直す
- 「PR を作りません」「納品の報告を確認できない」→ 5 の「ローカル納品」

## 5. 納品
1. **プレビューを Claude Artifact で公開する**（Vercel は使わない）。
   - `artifact-design` スキルを読んでから、`jobs/<id>/preview.html` に一覧ページを書く：案件名、brief の一文要約、媒体ごとの見出しと、選んだレーンの `manifest.json` の成果物ごとに `<lane のフォルダ名>/work/<…>/index.html` への相対リンクとサイズ。成果物の HTML 本体は手を加えずそのまま載せる。
   - 公開するファイルを集めて確かめる：`node ${CLAUDE_PLUGIN_ROOT}/scripts/artifact-files.mjs --root jobs/<id> --page jobs/<id>/preview.html`。止まったらリンク切れを直してやり直し、通ったら出力の `file_path`・`root`・`files` をそのまま Artifact ツールの publish に渡す（`files` を手で書かない）。`icon` は `layout`、`description` は案件名と媒体。
   - 返ってきた URL を `jobs/<id>/artifact.json` の `url` と `published`（`review` はそのまま残す）と `progress.md` に書く。修正回はこの URL を更新し、新しい URL を作らない。
   - Artifact は最初は非公開。他の人に見せるときは持ち主が claude.ai で共有する、と PR に書く。
   - Artifact ツールが使えない環境では公開を飛ばし、PR のプレビュー欄に「Artifact 未公開（この環境で使えなかった）」と書く。
2. 依頼フォルダをコミットし、ブランチを push して PR を1つ作る（媒体が複数でも PR は1つ）。
   - コマンド：`git push -u origin <ブランチ>`、`gh pr create --base <既定のブランチ> --head <ブランチ> --title "design: <案件名>" --body-file <本文のファイル>`。gh がない環境（クラウドなど）では、使える GitHub のツールで同じ PR を作る。
   - 修正回（`jobs/<id>/delivery.json` に `pr` がある）は新しい PR を作らず、同じブランチに push して、PR にコメントで今回の結果を返す。
   - 作った（または更新した）PR の URL を `jobs/<id>/delivery.json` に `{ "pr": "<URL>", "branch": "<ブランチ>" }` で書く。次に止まったとき、関門 hook が PR があるか・最新の commit が push されているかを確かめる。
   - push や PR の作成に失敗したら、黙ってターンを終えない。理由を progress.md に書き、報告に載せる。
   - PR タイトルは `design: <案件名>`。本文は次の形（hook が伝えた結果が「全工程に合格」以外なら、冒頭の注意書きを入れ、表の該当する行に「未合格（上限 n 回）」「採点エラーで打ち切り」「撮影できずに打ち切り」「未検品」をそのまま書く）：

```
> [!WARNING]
> 未合格の工程があります：<hook が伝えた結果と理由>（全工程に合格ならこの3行を消す）

## <案件名>
媒体：<medium>, <medium> ／ 成果物：<n> 点
プレビュー：<Artifact の URL>（非公開。共有は claude.ai から）／ 最後の確認のページ：<review の URL>
かかった時間：<summary.json の minutes> 分 ／ 採点の費用：$<summary.json の eval_cost_usd>（critic と user-tester の分）

### <媒体>（`jobs/<id>/<選んだレーン>/`）
| 工程 | 結果 |
|---|---|
| 探索 | 審査の順位 <RANKING>。磨いたレーン：<dA>（名前）・<dB>（名前）。依頼者が選んだのは <dN>（決め手：<…>） |
| HTML | <scores>（<n> 回目で合格 ／ 未合格：上限 <n> 回。点数が一番高かった回に戻したときは「build NN の版を納品」） |
| ユーザーテスト | <tasks / blockers>（対象外なら「なし」、上限なら「未合格：上限 <n> 回」） |
| Figma | <scores>（<url>、00 Review から見る。選ばなかったら「仕上げで選ばず」、未接続・未検品ならそう書く） |

（媒体ごとに「### <媒体>」と表を繰り返す）

## 見てほしいところ
- 最後の確認で決まったこと：（仕上げ・仮のものの決め方）
- 仮のまま残したもの：（各レーンの `shots/final/index.md` の「仮の画像」「仮のコピー」「要コピー」と、contract.md の未確定事項。どの媒体の、どの成果物のどこか）

## スクショ
（媒体ごとに、選んだレーンの shots/final/ の画像を並べる）

## レビューのしかた
気になる点を PR にコメントしたら、Claude Code で「この PR の指摘を直して」と頼むと、修正と学習が回ります。クラウドの Project でスケジュールタスク studio-feedback を設定していれば、`feedback` ラベルを付けるだけで自動で回ります。良ければそのままマージ。
```

3. Slack コネクタがあり `studio/config.json` の notify.slack_channel が空でなければ、PR と Artifact の URL、結果の表を送る（mention があれば付ける）。
4. ターンを終える。hook が PR（ローカル納品なら報告）を確かめてから、状態を done にする。

### ローカル納品（PR を作らないとき）
`studio/config.json` の `defaults.delivery` が `local` のとき、git のリポジトリでないとき、git のリモートがないときは、hook が「PR を作りません」と伝える。そのときは上の 2 の代わりに次を行う（1 の Artifact、3 の Slack（PR の URL の代わりに報告のパス）、4 はそのまま）。
- push も PR の作成もしない。案件のブランチは手元に残す（持ち主が手元でマージする）。
- 2 の PR 本文と同じ形の報告を `jobs/<id>/delivery.md` に書く。タイトルは `# design: <案件名>`。「レビューのしかた」の節だけ次に置き換える：

```
## レビューのしかた
直してほしいところは、Claude Code のチャットでそのまま伝えてください。修正が回り、この報告が書き直されます。
このままで良ければ、チャットで「<案件ID> はこれで OK」のように伝えてください（手直しなしの承認として記録されます）。案件のブランチ `<ブランチ>` は、手元で既定のブランチにマージしてください。
```

- `jobs/<id>/delivery.json` に `{ "local": "jobs/<id>/delivery.md", "branch": "<ブランチ>" }` を書く（git でなければ `branch` は書かない）。
- 修正回も同じ `delivery.md` を今回の結果で書き直す。
- 依頼者には、報告のパスとプレビューの URL を伝えてからターンを終える。
