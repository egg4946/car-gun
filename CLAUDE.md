# CLAUDE.md

ゲームの内容・構成・マップのインターフェース・作業ルールは **`AGENTS.md`** にまとめてある。まずそれを読むこと。
(Codex と共有する方針なので、重複して書かない。変更があれば `AGENTS.md` を更新する。)

## Claude Code 向けの補足

- コマンド: `npm run dev`(5173番、`.claude/launch.json` に `dev` として登録済み)/ `npm test` / `npm run build`。
- Codex が `src/forest.js` と `tests/forest.test.js`(森マップ)を担当している。これらは編集しない。
  マップ切り替えのための `src/main.js` の統合は Claude 側の担当。
- `src/world.js`(街マップ)は書き換え中。`tests/world.test.js` は `isRoad` / `START` / `roadSpot` / `sidewalkSpots` を要求しており、
  現状は失敗している。実装が追いつくまで、このテストの失敗は想定内。
- 日本語で応対し、コードのコメントも日本語で書く。
