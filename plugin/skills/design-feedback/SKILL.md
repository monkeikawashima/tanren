---
name: design-feedback
description: デザイン案件へのレビュー・指摘・感想を受けたら必ず使う。PR に feedback ラベルが付いたとき、PR のレビューコメント、チャットでの「ここ直して」「これは良い」「d2 の方が好き」「全体的に軽い」など。修正を回し、指摘をスタジオの審美眼に積む。PR がマージされたときの記録にも使う。
---

# design-feedback — 修正と学習

サブエージェントは `tanren:<名前>`（例：`tanren:librarian`）で呼ぶ。

## 1. 案件を特定する
PR のブランチ、PR 本文の `jobs/<id>`、またはチャットの文脈から案件 id を決める。分からなければ `jobs/` の最新を候補として1つ挙げ、それで進める。

## 2. 指摘を集める
- PR から：レビューコメント、インラインコメント、PR 会話のコメント（使える GitHub ツールで取得）。
- チャットから：依頼者の発言そのもの。
- マージされた PR で、変更要求がなかった場合は「手直しなしで承認」として扱う。

## 3. 学習（毎回）
librarian サブエージェントを呼ぶ。渡すもの：案件 id、集めた指摘の原文、`jobs/<id>/shots/final/`、critic の最終判定（verdicts の最後の build-*.md）、探索で依頼者が方向性を選んだ記録（`verdicts/explore-*-human.md`。あれば）。
librarian は taste の更新を別 PR で出す。

`jobs/<id>/review.json` に記録を追加する：

```json
{ "rounds": [ { "date": "YYYY-MM-DD", "source": "pr|chat", "outcome": "accepted|minor|major", "items": 5 } ] }
```

## 4. 修正（「今回の修正」があるとき）
1. 指摘を `jobs/<id>/verdicts/human-<NN>.md` に critic と同じ形式で書く（VERDICT: FAIL、修正リストに指摘を1件ずつ。依頼者の言葉を変えない）。
2. `jobs/<id>/contract.md` の末尾に `## レビューで追加された合格条件（<日付>）` を足し、指摘を確かめられる条件に直して書く。critic は次の採点からこれも見る。
3. `.loop/state.json` を、この案件・status `running`・phase `build` に戻す。build.max は今の iteration に 5 を足す。`usertest.done` と `figma.done` は false に戻し、`figma.iteration` はそのまま残す（Figma は作り直さず修正回としてその場で直る）。
   - 指摘が「デザインシステムを新しいもの（または別のもの）にして」なら、`design-job` の「0. 案件を作る」の 5 と同じ手順で `jobs/<id>/assets/ds/` を取り直してから（別のものなら brief の「デザインシステム」欄も書き換えて）、修正リストに「新しいデザインシステムに合わせる」を足す。
4. designer サブエージェントを呼ぶ。指示は「修正モード。verdicts/human-<NN>.md を上から全部直す」。
5. 2行で要約してターンを終える。以降は design-job の「3. 磨き」「4. 納品」と同じく関門 hook が回す。納品では新しい PR を作らず、同じ PR に push してコメントで結果を返す。プレビューは `jobs/<id>/artifact.json` の URL を Artifact ツールで先に read し、同じ URL へ publish し直して更新する（新しい Artifact を作らない）。
