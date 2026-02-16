# 荒れるコメント作成ゲーム MVP

既存の Vite フロント資産（ヘッダー/共通パネル/ホーム導線）を流用し、
`ルーム作成 -> ラウンド進行 -> 同時投稿 -> 一斉公開 -> 4軸採点 -> 結果表示` までを実装した MVP です。

## 実装範囲
- ルーム作成 / 参加（6桁コード）
- ロビーでホスト設定
  - ラウンド数（デフォルト 3）
  - 制限時間（デフォルト 60 秒）
  - 匿名公開 ON/OFF
  - お題上書き（任意）
- ラウンド進行（サーバ主導タイマー）
- 投稿（時間内上書き可、他人投稿は公開まで非表示）
- 一斉公開（時間切れ or ホスト手動）
- 4軸プレイヤー採点（自分以外を各軸1位）
- 集計（1票 = 10点、軸合算）
- 結果表示（軸別/合計/失格）
- 次ラウンド進行 / ラウンド終了

## ライン越え判定（簡易）
投稿受理時にサーバで簡易判定します。

判定対象（config で差し替え可）:
- 電話番号 / 住所らしき表現
- 脅迫語
- 差別語
- 露骨な罵倒語

挙動:
- ライン越えは `isDisqualified=true`
- reveal で本文をマスク表示
- result で失格（0点）表示

設定ファイル:
- `server/moderation-config.js`

## 技術構成
- Frontend: Vite + Vanilla JS
- Realtime: Socket.IO
- Backend: Node + Express + Socket.IO
- Data: メモリ保持（再起動で消える）

## 起動手順
1. 依存インストール
```bash
npm install
```

2. クライアント + サーバ同時起動
```bash
npm run dev
```

3. アクセス
- クライアント: `http://localhost:5173`
- サーバ: `http://localhost:8787`

## ルーティング
ハッシュルーティングで MVP 画面を表現しています。

- `#/` : ホーム（作成/参加）
- `#/room/:code/lobby`
- `#/room/:code/round`
- `#/room/:code/reveal`
- `#/room/:code/score`
- `#/room/:code/result`

## データモデル（メモリ）
- Room
  - `code, hostId, status`
  - `settings: { roundCount, timeLimitSec, anonymous }`
  - `players: [{ id, token, name, joinedAt, socketId, connected }]`
  - `rounds: Round[]`
- Round
  - `roundNo, topicText, status, startedAt, deadlineTs`
  - `submissions: [{ playerId, text, submittedAt, isDisqualified, dqReason }]`
  - `votes: [{ voterId, axis, submissionPlayerId }]`
  - `scoresComputed: { bySubmissionPlayerId: { axisScores, total, isDisqualified, dqReason } }`

## Socket.IO イベント仕様
### Client -> Server
- `room:create { name }`
- `room:join { code, name, playerToken? }`
- `room:getState { code }`
- `room:updateSettings { code, settings }`
- `round:start { code, topicOverride? }`
- `submission:update { code, text }`
- `round:reveal { code }`
- `scoring:start { code }`
- `scoring:submitVotes { code, votes }`
- `result:finalize { code }`
- `round:next { code, topicOverride? }`

### Server -> Client
- `room:state`
- `round:tick { roundNo, remainingSec, deadlineTs, nowTs }`
- `submission:updated { roundNo, submittedCount, totalPlayers }`
- `reveal:ready { roundNo, reason }`
- `vote:updated { roundNo, votedCount, totalVoters }`
- `result:ready { roundNo, scoresComputed }`

## 補足
- AI 採点 / AI お題生成は未実装（将来拡張用にフロント・サーバ責務を分離）
- MVP のため DB 未使用（プロセス再起動でルーム消失）
- 再接続時は `localStorage` のトークンで同一プレイヤー復帰を試行
