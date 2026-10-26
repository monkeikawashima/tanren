# デザインシステムの形（studio/design-system/<名前>/）

クライアントのデザインシステムは、どこから取り込んでも（Claude の Design System、Figma、コード、ブランドガイド、既存サイト）この形にそろえる。agent も機械チェックも、この形だけを読む。取り込みは `design-system-import` スキル、設定の確認と変更は `design-system` スキルが行う。

1つのリポジトリに、名前を付けて複数のデザインシステムを置ける（例：全媒体で共通の `brand`、アプリ画面用の `product`、スライド用の `deck`）。どの媒体でどれを使うかは `studio/config.json` の `design_systems` で決める（下の「設定」）。

```
studio/design-system/
├─ brand/          1つのデザインシステム（中身は下）
├─ product/
└─ shared-havu/    リポジトリをまたいで共通で使うもの（shared:havu）の写し

studio/design-system/<名前>/
├─ README.md       決まり（下の節立て）
├─ tokens.json     値（下の形）。ここが正本
├─ tokens.css      tokens.json から ds-build.mjs が作る CSS 変数。手で書かない
├─ source.json     取り込み元と、いつ取ったか
├─ fonts/          フォントのファイル（あれば。ライセンスを README に書く）
├─ assets/         ロゴ・アイコン・写真などの支給アセット
└─ components/     部品・UI キットの HTML / CSS / 画像（あれば。取り込み元のパスのまま）
```

## tokens.json
グループごとに、名前 → 値の情報。どのグループも省略してよい。

```json
{
  "$format": "tanren/tokens@1",
  "color":      { "ink":     { "value": "#232324", "role": "text",   "status": "confirmed", "source": "figma" } },
  "font":       { "display": { "value": "'Space Grotesk', 'Zen Kaku Gothic New', sans-serif", "status": "inferred", "source": "claude-artifact" } },
  "fontSize":   { "base":    { "value": "15px", "status": "confirmed", "source": "code" } },
  "lineHeight": { "body":    { "value": "1.5",  "status": "confirmed", "source": "code" } },
  "space":      { "4":       { "value": "16px", "status": "confirmed", "source": "code" } },
  "radius":     { "md":      { "value": "6px",  "status": "confirmed", "source": "code" } },
  "shadow":     { "1":       { "value": "0 1px 2px rgba(35,35,36,0.04)", "status": "confirmed", "source": "code" } }
}
```

- `value`：CSS にそのまま書ける値。
- `status`：`confirmed`（ガイド・Figma・コードに明記されている）か `inferred`（サイトから抜き出した、推定で決めた、取り込み元自身が「仮・推定」と書いている）。
- `source`：取り込み元の id（source.json の `sources[].id`）。
- `role`（色だけ、任意）：`text` `background` `surface` `border` `accent` `success` `warning` `danger` `data` など。
- 名前は英数字と `-` だけ。CSS 変数は `--ds-<グループ>-<名前>` になる（例：`--ds-color-ink`、`--ds-font-display`）。

## README.md の節立て
1. 概要（ブランドと、このデザインシステムの性格を2〜3行）
2. 色の使い方（アクセントは何か、1画面にいくつまで、など）
3. 書体と文字組み（和文の書体がなければ、そう書く）
4. 余白・角丸・影
5. 部品と UI キット（`components/` に何があるか）
6. 文体（トーン、人称、表記、絵文字の可否）
7. 画像（写真・イラストの方針、使ってよいアセット）
8. 禁止事項（例：グラデーションを使わない）
9. 推定の値（`inferred` のもの。人間に確かめること）
10. 食い違い（取り込み元どうしで値が違ったもの、どちらを採ったか）
11. 取り込み元（source.json の要約）

各節の決まりにも、確定か推定かを書く（例：「グラデーションを使わない（確定：ブランドガイド p.12）」）。

## source.json

```json
{
  "imported_at": "2026-10-25T07:00:00Z",
  "sources": [
    { "id": "figma", "type": "figma", "ref": "https://www.figma.com/design/…", "priority": 1, "version": "…" },
    { "id": "guide", "type": "guide", "ref": "docs/brand-guide.pdf", "priority": 2 }
  ]
}
```

- `type`：`claude-artifact` `figma` `code` `guide` `website` のどれか。
- `priority`：小さいほど優先。値が食い違ったら、優先の高い取り込み元の値を採る。
- `version`：取り込み元が版を持つとき（Artifact の version id、Figma のファイルの版、コードのコミット）。design-job はこれで更新の有無を見る。

## 確定と推定の扱い
- `confirmed` の値・決まりに反したら不合格（機械チェックと critic）。
- `inferred` の値・決まりは守るよう努めるが、反しても参考として出すだけ。PR の「人間への質問」に載せて確かめてもらい、確かめられたら `confirmed` に直す。

## 設定（studio/config.json の design_systems）

```json
"design_systems": {
  "status": "set",
  "default": "brand",
  "by_medium": { "ui": "product", "prototype": "product", "slide": "deck", "identity": null },
  "systems": {
    "brand":   { "title": "ブランド共通", "extends": "shared:havu", "sources": [ { "id": "guide", "type": "guide", "ref": "docs/brand.pdf", "priority": 1 } ] },
    "product": { "title": "アプリ画面", "extends": "brand", "sources": [ { "id": "figma", "type": "figma", "ref": "https://www.figma.com/design/…", "priority": 1 } ] },
    "deck":    { "title": "スライド", "extends": "brand", "sources": [] }
  }
}
```

- `status`：`unset`（まだ決めていない）・`none`（このリポジトリではデザインシステムを使わない）・`set`（下の設定で使う）。
- `default`：`by_medium` に載っていない媒体で使うもの。`null` ならなし。
- `by_medium`：媒体（`${CLAUDE_PLUGIN_ROOT}/studio/media.md` の medium）ごとの割り当て。値が `null` の媒体は、あえてデザインシステムを使わない（例：ロゴの探索）。
- `systems`：名前ごとのデザインシステム。名前は英小文字・数字・`-`。中身は `studio/design-system/<名前>/`。
  - `sources`：取り込み元（source.json と同じ形）。空でもよい（`extends` で土台を使い、`studio/design-system/<名前>/` に手で足したものだけを重ねる場合）。
  - `extends`：土台にするデザインシステムの名前。土台の値と決まりの上に、自分の値と決まりを重ねる（食い違えば自分が優先）。`shared:<id>` は、リポジトリをまたいで共通で使うもの（下）。
- **選び方**（design-job が `ds-build.mjs --select <medium>` で決める）：案件の brief の「デザインシステム」欄 → `by_medium` → `default` の順。`status` が `unset` なら、案件は「デザインシステムなし」で進め、依頼者への質問に「デザインシステムが未設定」と出す。
- **使うとき**：`ds-build.mjs --resolve <名前> --out jobs/<id>/assets/ds` で、`extends` をたどって合成した1つのデザインシステムを案件に写す。案件は始めたときの写しを使い続けるので、途中で設定を変えても進行中の案件の見た目は変わらない。
- 古い形（`design_system.sources` が1つだけ）は、`default` という名前のデザインシステムが1つある状態として読む。

## リポジトリをまたいで共通で使うデザインシステム（shared）
自社のブランドのように、複数のリポジトリで同じデザインシステムを使うときは、使う人の Mac の `~/.claude/tanren/shared-design-systems.json` に登録しておく。

```json
{ "havu": { "title": "HAVU ブランド", "sources": [ { "id": "ds", "type": "claude-artifact", "ref": "https://claude.ai/artifact/…", "priority": 1 } ] } }
```

- `design-system` スキルと studio-init が、ここに登録されたものを候補に出す。
- 使うリポジトリでは `systems` に `"shared:havu": { "sources": [ …登録と同じ… ] }` として写し、`studio/design-system/shared-havu/` に取り込む。中身は各リポジトリが写しを持つ（クラウド・CI・ほかの人のアカウントでも同じものを使うため）。
- 共通の取り込み元が更新されたら、各リポジトリで案件を始めるときに取り直す（取り込み元の版で判断）。
