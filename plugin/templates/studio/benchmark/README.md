# benchmark — 採点役の検証セット

自動改善で一番危ないのは、採点役が「合格しやすい方向」に緩むこと。点は上がるのに出来は下がる。
それを防ぐため、人間の判定が分かっている過去の案件をここに固定し、critic や採点基準を変えるときは必ずこのセットで一致率を測る。

## 中身
`cases/<job-id>/`
- `brief.md`、`contract.md`、`manifest.json`：その案件の条件
- `shots/`：人間がレビューした時点の最終スクショ
- `outcome.json`：人間の判定

```json
{ "medium": "banner", "human_outcome": "accepted", "flagged": [], "note": "そのまま通した" }
```

`human_outcome` は 3 値：
- `accepted`：手直しなしで通した → critic は PASS を出すべき
- `minor`：小さな手直しで通した → どちらでもよい（一致率の計算から外す）
- `major`：大きく作り直させた → critic は FAIL を出すべき

## 使い方
Claude に「bench を走らせて」と頼む。スクリプトは tanren プラグインの `scripts/bench.mjs`（`--limit 5` で試しに5件）。

結果は `studio/benchmark/results/<日時>.json` に残る。coach は critic・rubrics・taste の変更案を出す前後でこれを走らせ、一致率が下がる変更は出さない。

ケースは librarian が人間のレビュー時に追加する。major と accepted が両方そろうほど検証が効く。目安は各 10 件以上。
