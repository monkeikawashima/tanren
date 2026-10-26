---
name: studio-init
description: tanren を新しいリポジトリで使えるようにする（1回だけ）。「スタジオを準備して」「tanren をこのリポジトリで使いたい」「studio-init」と言われたとき、または design-job を始めようとして studio/config.json がないときに使う。studio/、jobs/、許可設定、.gitignore、Playwright の依存を用意し、最後に持ち主の好みを二択と参考事例で聞いて審美眼（studio/taste/）に種をまく。「審美眼を作りたい」「好みを覚えさせたい」と言われたときも、6 の種まきだけを行う。
---

# studio-init — リポジトリにスタジオを用意する

ひな形は `${CLAUDE_PLUGIN_ROOT}/templates/` にある。**既にあるファイルは上書きしない。** 足りないものだけ足し、最後に何を足して何を残したかを一覧で返す。

## 1. 確かめる
- git リポジトリの直下で動いているか。違えば止めて、どのフォルダで使うかを聞く。
- `plugin/.claude-plugin/plugin.json` があるなら、ここはエンジンの配布元リポジトリなので何もしない（studio/ と設定は最初からある）。

## 2. studio/ と jobs/
- `${CLAUDE_PLUGIN_ROOT}/templates/studio/` の中身を `studio/` にコピーする。同じパスのファイルが既にあれば飛ばす。
- `jobs/.gitkeep` を作る。
- ここに置くのはこのリポジトリだけのもの（審美眼・検証セット・採点ログ・設定）。採点基準・手順書・媒体一覧はプラグイン側にあるので、コピーしない。

## 3. .gitignore
`${CLAUDE_PLUGIN_ROOT}/templates/gitignore` の各行のうち、`.gitignore` にまだない行だけを末尾に足す。

## 4. 許可設定とプラグインの有効化
`.claude/settings.json` に `${CLAUDE_PLUGIN_ROOT}/templates/settings.json` を合わせる。
- `permissions.allow`：まだない項目だけ足す。既存の項目は消さない・並べ替えない。
- `extraKnownMarketplaces.tanren`：GitHub の配布元を `autoUpdate: true` で書く。これで、このリポジトリを開いた人は手で登録しなくても plugin が入り、main の更新が自動で届く。既に同じ名前で別の source が書かれていたら書き換えず、人間に知らせる（配布元の登録は名前1つにつき1つなので、source が違うとリポジトリを開くたびに登録が入れ替わる）。
- `enabledPlugins`：`tanren@tanren` を true にする（このリポジトリでだけスキルと関門 hook が動くようにするため）。
- 既存のキーはそのまま残す。JSON として読めない場合は書き換えず、人間に知らせる。

## 5. Playwright
撮影と採点に使う。プラグインの置き場所には node_modules がないので、このリポジトリに入れる。
- **パッケージマネージャーは pnpm を基本にする。** そのリポジトリにすでにロックファイルがあれば、それに合わせる（`package-lock.json` なら npm、`yarn.lock` なら yarn、`pnpm-lock.yaml` なら pnpm）。ロックファイルがなければ pnpm を使う。
  - `pnpm --version` で入っているか確かめる。入っていなければ npm に切り替えず、人間に `corepack enable pnpm` の実行を頼む（環境の設定を変えるので、代わりにしない）。
- `package.json` がなければ `{ "private": true, "type": "module" }` で作る。pnpm を使うなら `"packageManager": "pnpm@<pnpm --version の結果>"` も書く。
- `devDependencies` に `playwright` と `@axe-core/playwright` がなければ、選んだパッケージマネージャーで足す（pnpm なら `pnpm add -D playwright @axe-core/playwright`）。
- `scripts.setup` がなければ足す。pnpm なら `pnpm install && pnpm exec playwright install --with-deps chromium`（npm なら `npm install && npx playwright install --with-deps chromium`）。
- インストールを実行する。許可されなかったとき、またはネットワークの都合で失敗したときは、人間に `! pnpm run setup`（そのリポジトリのパッケージマネージャーの setup）を実行してもらうよう伝えて先へ進む。

## 5.2 PR を作れるか
納品で PR を作るので、ここで確かめる（直すのは人間。代わりにログインしない）。
- `git remote -v` に GitHub のリモートがあるか。なければ、報告に「GitHub のリモートがないので PR を作れない」と書く。
- `gh auth status` が通るか。gh がない、またはログインしていなければ、人間に `! gh auth login` を頼む（クラウドのスレッドでは GitHub のコネクタで作るので要らない）。
- 既に `.claude/settings.json` があるリポジトリで tanren を更新したときも、4 の許可設定を合わせ直す（push と PR 作成の許可が後から増えたため）。

## 5.5 デザインシステム
どのデザインシステムを使うかを、ここで必ず決める。`design-system` スキルの「決める」を呼ぶ（候補の提示、既定、媒体ごとの割り当て、取り込みまで、そのスキルが行う）。
- 取り込んだものが色・書体・部品の正本になる（審美眼より優先。ただし推定の値は参考）。写しをリポジトリに残すのは、取り込み元を読めない環境（クラウド・CI・ほかの人のアカウント）でも同じものを使うため。
- 「使わない」なら `status: "none"`。director が案件ごとにトークンを提案し、画像は plugin の仮素材で仮置きする。
- 「あとで」なら `status: "unset"` のまま。案件を始めるたびに「デザインシステムが未設定」と依頼者への質問に出る。いつでも `/tanren:design-system` で決められる。

## 6. 審美眼の種まき
審美眼（`studio/taste/`）が空のまま最初の案件を回すと、director も designer も critic も比べる相手がなく、AI のいつもの無難な形に流れる。最初の案件の前に、持ち主の好みを積んでおく。

**飛ばす条件**：`studio/taste/references/good/` に画像があるか、`rules.md` に箇条（`- `で始まる行）が1行以上あれば、もう種がまかれているので飛ばす。持ち主が「あとで」と言ったときも飛ばし、報告に「審美眼が空」と書く。

作業場所は `.loop/taste-seed/`（git に入らない）。持ち主の言っていないことは審美眼に書かない（librarian と同じ原則）。

### 6-1. 聞く（1回にまとめて聞く）
- このリポジトリは誰の何のデザインを作るか（ブランド名、既存サイトの URL、ブランドガイドや指定書体があればその場所）
- 好きなデザインの URL か画像を3〜10件と、それぞれ一言の理由
- 「これはない」と思うデザインの URL か画像を1〜5件と、一言の理由
- 画像はリポジトリ内の場所を教えてもらうか、`.loop/taste-seed/inbox/` に置いてもらう

### 6-2. 参考を撮る
- URL は `node ${CLAUDE_PLUGIN_ROOT}/scripts/capture.mjs --url <URL> --out .loop/taste-seed/refs/<短い名前>` で撮る（1440 と 390 のファーストビュー）。撮れなかった URL は報告に書き、画像をもらう。
- 撮れたものは開いて全部見る。ログイン画面やクッキーの同意画面しか写っていなければ撮り直しを頼む。

### 6-3. 二択を作る
同じ内容を、1つの軸だけ変えた2案にして、6〜8組つくる。軸は 6-1 の答えから、好みが読み取れないものを優先して選ぶ。デザインシステムがあるときは、色と書体はデザインシステムで決まっているので軸にせず、どちらの案もデザインシステムの範囲で作る：
- 書体：明朝見出し／ゴシック見出し
- 余白：たっぷり（画面の 50% 以上が余白）／詰める
- 文字の大きさの差：大きい（見出しが本文の 3 倍以上）／控えめ（1.5 倍程度）
- 色：無彩色＋差し色1色／ブランド色を広く使う
- レイアウト：左寄せ・非対称／中央揃え・対称
- 写真の扱い：大きく1枚／小さく複数（画像は plugin の仮素材 `${CLAUDE_PLUGIN_ROOT}/placeholders/` で仮置きする）
- 装飾：線や罫で区切る／余白だけで区切る
- 角：角丸／直角

作り方：
- `.loop/taste-seed/work/pNN-a/index.html` と `pNN-b/index.html`。サイズは 1440x900 の Web のファーストビュー（ブランドの主な媒体がほかにあれば合わせる）。
- 文言は 6-1 で分かったブランドの言葉か、事実を含まない汎用の文（「サンプル見出し」など）だけ。数字・実績・社名を作らない。
- 変えるのはその組の軸だけ。それ以外は `${CLAUDE_PLUGIN_ROOT}/studio/playbook.md` の「文字組み」に従い、どちらも崩れのない出来にする（下手な方が負けるだけの二択にしない）。
- `.loop/taste-seed/manifest.json` に全案を載せ、`node ${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs --job .loop/taste-seed --out shots` で撮る。機械チェックで落ちた案は直してから撮り直す。

### 6-4. 選んでもらう
- `artifact-design` スキルを読んでから、`.loop/taste-seed/pairs.html` に一覧ページを書いて Artifact で公開する：組ごとに A と B のスクショを並べ、組の番号と A/B のラベルだけを付ける（どちらが何の軸かは書かない。先入観なしで選んでもらう）。続けて、6-2 で撮った参考のスクショも並べる。`root` は `.loop/taste-seed`、`files` にスクショを載せる。
- Artifact が使えなければ、スクショを SendUserFile で送る。
- 持ち主には「各組 A か B と、言えれば一言の理由（例：1A 余白が気持ちいい）」で答えてもらう。「どちらでもない」も可。

### 6-5. 積む
- `pairs.md`：組ごとに1行。案件の欄は `seed`、決め手は持ち主の言葉（なければ空）。「どちらでもない」は書かない。
- `references/good/`・`bad/`：6-2 の参考と、選ばれた案（good）・選ばれなかった案のうち持ち主が理由を言ったもの（bad）をコピーする。ファイル名に理由を入れる（例：`good-余白で区切る-seed-p03.png`、`bad-詰まって見える-seed-p02.png`、`good-<名前>-<持ち主の一言>.png`）。
- `rules.md`：二択と参考から読み取れる基準を、該当する節に下書きする。**書く前に持ち主に見せて確認をもらう。** 確認が取れた行だけ `- [ルール] 理由。（出典: seed / <日付>）` の形で書く。同じ軸で2組以上が同じ向きに選ばれたもの、持ち主が理由で言い切ったものだけを下書きにする。
- ブランドガイドや指定書体があれば、`rules.md` の「タイポグラフィ」「色」に、出典をそのガイドにして写す。
- `.loop/taste-seed/` は消さずに残す（git には入らない）。

## 7. 確認と報告
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.mjs` が動くか確かめる（studio/ が読めていれば、ダッシュボードを作って終わる）。
- コミットはしない。足したファイルと変えた設定、積んだ審美眼（ルールの行数、good / bad の枚数、二択の組数）を一覧にして返し、「次は〇〇を作って、と依頼してください」と伝える。
- CI（GitHub Actions の `anthropics/claude-code-action`）で使うなら、`plugin_marketplaces` に `https://github.com/monkeikawashima/tanren.git`、`plugins` に `tanren@tanren` を渡す必要がある（CI は `.claude/settings.json` の plugin を自動では入れない）、と添える。
