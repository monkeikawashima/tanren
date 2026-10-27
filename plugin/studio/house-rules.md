# 制作のルール

designer と figma-builder が毎回読む。どのリポジトリで使っても同じ。

## 置き場所
- エンジン（agents・scripts・採点基準・手順書）は `${CLAUDE_PLUGIN_ROOT}/` にある。
- 案件は `jobs/<id>/`、審美眼・検証セット・採点ログ・設定は `studio/`、hook の状態は `.loop/` にある（どれも使う側のリポジトリ）。
- 1件の依頼の中は、媒体ごとのフォルダ `jobs/<id>/<媒体>/` に分かれる（例：`jobs/<id>/lp/`、`jobs/<id>/banner/`）。このファイルとスタッフの手順書で `jobs/<id>/` と書いてあるところは、この媒体のフォルダを指す。依頼フォルダの直下には、依頼全体の `brief.md`・`preview.html`・`delivery.json`・`summary.json` だけを置く。
- 自分の媒体のフォルダの外には書かない（同じ依頼のほかの媒体は、別の designer が並行して作っている）。

## 成果物
- 成果物は `jobs/<id>/work/<deliverable>/index.html`（HTML + CSS + 必要なら SVG / JS）。外部 CSS フレームワークは使わない。プロトタイプは複数の HTML を相対リンクでつなぐ。
- 色・余白・文字サイズは `jobs/<id>/tokens.json`（なければ director が作る）を CSS 変数として使う。
- 色・書体・部品は、`jobs/<id>/assets/ds/` にクライアントのデザインシステムがあればそれが正本（この案件の媒体に割り当てたデザインシステムを、土台と重ねて写したもの。形は `${CLAUDE_PLUGIN_ROOT}/studio/design-system-format.md`）。確定（confirmed）の値と決まりは必ず守り、推定（inferred）のものは守るよう努める。なければ `tokens.json`。
- 画像は次の順で用意する（`images.json` に従う）。仮のもの（3〜5）には `data-provisional="image"` の印を付ける。
  1. `jobs/<id>/assets/` の支給素材
  2. デザインシステムのアセット（`assets/ds/`）
  3. デザインシステムの UI キットで組んだ製品の画面。中のデータは見本と分かるものにし、UI キットにない機能や数字を見せない
  4. design-job が生成した仮の画像（`assets/gen/`）
  5. plugin の仮素材。`jobs/<id>/assets/placeholders/placeholders.css` を読み込み、部品を `${CLAUDE_PLUGIN_ROOT}/placeholders/snippets.html` からコピーする（写真・動画・製品の画面・アバター・ロゴ）。「画像：〇〇」には何が入るかを具体的に書き、`data-label` にも同じことを書く。色は `--ph-*` を上書きしてデザインシステムやトークンに寄せる。グレーの箱を自分で作らない
     - brief の「仮の画像」が「生成アート」なら、写真の面は `.ph--art` にして、`assets/placeholders/art/<images.json の id>.svg` を `<img class="ph__art">` で敷く（部品集の「生成アート」）。images.json にない面が要るときは `node ${CLAUDE_PLUGIN_ROOT}/scripts/placeholder-art.mjs --part jobs/<id> --id <名前> --ratio <比率>` で足す（同じ媒体の中で絵が重ならないように選ばれる）。同じ絵を2か所に使わない。「グレー」なら今までどおりの面にする
     - 動画・製品の画面・アバター・ロゴは、どちらでも今までどおりの部品にする
- 仮の画像にしてよいのは、雰囲気・情景・質感・抽象的なものだけ。依頼者の商品・店舗・ロゴ・実在の人物・文字入りの画像は生成しない（本物と誤解されるため）。これらは支給素材を待ち、仮素材で仮置きする。
- 文言は brief にあるものを優先する。足りないコピーは、brief の言葉から組み立てた仮のコピーを、本番と同じ見た目で入れ、`<span data-provisional="copy" data-label="用途">` で囲んで、仮素材の「仮」の札（`.ph-tag`）を添える。brief にない数字・実績・社名・人名・受賞歴・料金は、仮でも作らない。それが要る箇所は、仮素材の「要コピー」の差し込み口（`.ph-slot`、`data-provisional="copy-needed"`）にする。
- 仮の画像と仮のコピーは、撮影のときに一覧になり（`shots/*/index.md`）、PR と Figma の 00 Review に載せて、依頼者に差し替えてもらう。
- 人間に見せるモック・プレビューは Claude Artifact で公開し、URL で渡す（Vercel は使わない）。手順は `design-job` スキルの「4. 納品」。
- 撮影と機械チェックは `node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs` で行う。`jobs/<id>/manifest.json` に載っていない成果物は採点されない。

## 正本（制作中は誰も書き換えない）
- `${CLAUDE_PLUGIN_ROOT}/studio/rubrics/`、`studio/taste/`：採点基準と審美眼。変更は librarian と coach だけが、PR として出す
- `jobs/<id>/brief.md`、`jobs/<id>/contract.md`：その案件の依頼と合格条件
- `.loop/`：hook の状態

## ログ
- 各回の終わりに `jobs/<id>/progress.md` へ追記する：直したこと、残課題、人間への質問。
- 採点結果は hook が `jobs/<id>/verdicts/` と `studio/metrics/runs.jsonl` に書く。
