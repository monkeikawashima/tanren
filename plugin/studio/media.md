# 媒体と標準サイズ

director が contract と manifest を作るときに参照する。サイズは各プラットフォームの仕様変更で変わるので、案件ごとに入稿先の最新仕様を確認して上書きする（brief に書けばそちらが優先）。

| medium | 主な成果物 | 標準サイズ（px / 実寸） | manifest の指定 |
|---|---|---|---|
| prototype | 画面遷移できる HTML モック | ui と同じ。画面ごとに id | fullPage: true、主要フローの全画面
| renewal | 既存サイトの全面リニューアル | 375・1440（改修前は crawl.mjs が撮影） | テンプレートごとに id＋プロトタイプ
| ui | アプリ画面、Webアプリ、管理画面 | iOS 393x852、Android 412x915、デスクトップ 1440x900 | fullPage: true、状態ごとに id を分ける |
| web | LP、サイト、記事ページ | 375x667、768x1024、1440x900 | fullPage: true、3幅すべて |
| banner | ディスプレイ広告、サイト内バナー | 300x250、336x280、728x90、320x50、320x100、160x600、300x600、970x250 | 1サイズ1 id、scale: 2 |
| social | フィード投稿、ストーリーズ、OGP、サムネイル | 1080x1080、1080x1350、1080x1920、OGP 1200x630、動画サムネイル 1280x720 | scale: 1 |
| print | ポスター、チラシ、名刺、DM | A4 210x297mm、B2 515x728mm、名刺 91x55mm（各 塗り足し3mm を足す） | pdf: {width, height} を必ず付ける |
| slide | 提案書、登壇資料 | 1920x1080 | 枚ごとに id、scale: 1 |
| email | HTMLメール、ニュースレター | 本文幅 600px、確認は 375 と 1024 | fullPage: true、colorScheme: "dark" 版も撮る |
| infographic | 図解、フロー図、記事内の図 | 記事内 800 幅、SNS 1080x1350 | 用途に応じて |
| motion | 動くバナー、UIアニメーション、ロゴアニメ | 用途のサイズに従う | frames: [0, 500, 1500, 3000, 最終ms] |
| identity | ロゴ案、シンボル、アイコンセット | プレゼンボード 1920x1080（16px・32px の縮小表示を含める） | scale: 2 |

## 書き出し
- PNG はレビュー用。最終データは人間が Figma / Illustrator / 各配信ツールで仕上げる前提。
- Figma への書き出しは figma-builder が行う（合格した HTML を html_to_figma で取り込み、use_figma で構造を整える）。
