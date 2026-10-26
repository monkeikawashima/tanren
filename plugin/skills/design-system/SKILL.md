---
name: design-system
description: このリポジトリのデザインシステムの設定を見る・決める・変える。どのデザインシステムを既定にするか、媒体ごとにどれを使うか（アプリ画面は product、スライドは deck、ロゴは使わない、など）、デザインシステムの追加・外す・取り直し、リポジトリをまたいで共通で使うもの（shared）の登録。「デザインシステムを見せて」「どのデザインシステムを使ってる？」「LP は brand で」「スライドは別のデザインシステムにして」「デザインシステムを変えて」「デザインシステムを足して」「共通のデザインシステムを登録して」と言われたとき、studio-init の 5.5 から呼ばれたときに使う。
---

# design-system — デザインシステムの設定

設定は `studio/config.json` の `design_systems`、中身は `studio/design-system/<名前>/`。形と選び方は `${CLAUDE_PLUGIN_ROOT}/studio/design-system-format.md`（最初に読む）。取り込みそのものは `design-system-import` スキルに任せる。

古い形（`design_system.sources` が1つだけ）のリポジトリでは、最初に新しい形へ書き換える：`systems.default` に `sources` を移し、`default: "default"`、`status: "set"`。中身が `studio/design-system/` 直下にあれば `studio/design-system/default/` に移す。書き換えたことを報告に書く。

## 見る（「どれを使ってる？」「見せて」）
次を表にして返す。変更はしない。
- `status`（未設定・使わない・設定済み）と `default`
- 媒体ごとに、実際に使われるもの（`${CLAUDE_PLUGIN_ROOT}/studio/media.md` の全媒体について `node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs --select <medium>` の結果）
- `systems` ごとに：名前・題・`extends`・取り込み元・トークンの数（確定・推定）・最後に取り込んだ日（`source.json` の `imported_at`）
- `~/.claude/tanren/shared-design-systems.json` に登録されている共通のもの（あれば）

## 決める（studio-init の 5.5 から、または `status` が `unset` のとき）
決まるまで進む。ただし人間が「あとで」と言ったら `status: "unset"` のまま終え、「案件を始めるたびに未設定と出る」と伝える。
1. **候補を並べる**：共通の登録（`~/.claude/tanren/shared-design-systems.json`）、claude.ai の Design System（Artifact ツールの `list`、`type: "Design System"`）、このリポジトリにすでにあるもの。
2. **このリポジトリで使うか**：使わないなら `status: "none"` にして終える。
3. **既定を決める**：候補から選ぶか、新しく取り込む（`design-system-import` に名前と取り込み元を渡す）。名前は短い英小文字（例：`brand`）。
4. **媒体ごとの割り当て**：アプリ画面（ui・prototype）、スライド（slide）、メール（email）、ロゴ・アイコン（identity）について、既定と別のものを使うか、使わない（`null`）かを聞く。別のものなら 3 と同じく選ぶか取り込む。既定を土台に足すだけなら `extends` に既定の名前を書く。
5. 設定を書き、`status: "set"` にする。最後に「見る」の表を返す。

## 変える
言われたことだけを変える。変える前に、今の設定と変えた後の設定を並べて見せ、確かめてから書く。
- **割り当て**：「LP は brand で」→ `by_medium.web = "brand"`。「スライドは既定と同じでいい」→ `by_medium.slide` を消す。「ロゴは縛らない」→ `by_medium.identity = null`。
- **既定**：`default` を書き換える。
- **追加**：新しい名前で `design-system-import` を呼ぶ。土台があれば `extends` を書く。
- **外す**：`systems` から消す。その名前を `default`・`by_medium`・ほかの `extends` が使っていれば、先にどうするかを聞く。`studio/design-system/<名前>/` を消すのは、人間に確かめてから。
- **取り直す**：`design-system-import` の「更新するとき」を、その名前で呼ぶ（`extends` の土台も、変わっていれば取り直す）。
- **共通の登録**：「これを共通にして」→ `~/.claude/tanren/shared-design-systems.json` に `<id>` で書き、このリポジトリでは `shared:<id>` として使う。ほかのリポジトリへの適用は、そのリポジトリで行う。

変えた後は `node ${CLAUDE_PLUGIN_ROOT}/scripts/ds-build.mjs` で全体を検査する。

## 進行中の案件
案件は始めたときの写し（`jobs/<id>/assets/ds/`）を使うので、設定を変えても進行中の案件は変わらない。進行中の案件にも当てたいと言われたら、`design-feedback` スキルで「デザインシステムを取り直して直す」として回す。

## 記録
`studio/config.json` と `studio/design-system/` の変更は、案件とは別のコミットにする（CLAUDE.md の「studio/ の変更は案件の PR と別」）。コミットするかは人間に確かめる。メッセージは「デザインシステムの設定を変えた：<何を>」。
