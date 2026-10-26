---
name: studio-coach
description: スタジオ自体を改善するときに使う。夜間のスケジュールタスク、または「スタジオを振り返って」「仕組みを改善して」「精度はどうなってる？」「最近の成績を見せて」と頼まれたとき。全案件の採点ログと指標から、繰り返す失敗を見つけて手順書・機械チェック・採点基準を直す。
---

# studio-coach — スタジオの振り返りと改善

サブエージェントは `tanren:coach` で呼ぶ。

1. main ブランチの最新を取る。
2. `node ${CLAUDE_PLUGIN_ROOT}/scripts/metrics.mjs` を実行し、`studio/metrics/dashboard.html` を作り直す。
3. coach サブエージェントを呼ぶ。coach は playbook と機械チェックを直接直し、採点基準・審美眼・critic の変更は bench の結果つきで PR にする。
4. dashboard.html と coach-log.md の更新を main にコミットして push する。
5. Artifact ツールが使えるなら、dashboard.html を「tanren Dashboard」として公開（既にあれば同じ URL を更新）する。
6. 依頼者に返すのは3行だけ：指標の前回比、やった変更、承認待ちの PR。

ユーザーが会話で「精度はどうなってる？」と聞いただけなら、手順2の結果から指標の推移だけを答え、変更はしない。
