import express from "express";
import http from "http";
import { Server } from "socket.io";
import {
  AXIS_KEYS,
  DEFAULT_SETTINGS,
  FIXED_TOPICS,
  PLAYER_LIMIT,
  SCORE_PER_VOTE,
  STATUS,
} from "../src/game/constants.js";
import { detectLineCrossing } from "./moderation-config.js";

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

const app = express();
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

function randomId(prefix = "id") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function createRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function pickTopic(roundNo, overrideTopic) {
  if (overrideTopic && overrideTopic.trim()) return overrideTopic.trim();
  return FIXED_TOPICS[(roundNo - 1) % FIXED_TOPICS.length];
}

function createRoom(hostName) {
  let code = createRoomCode();
  while (rooms.has(code)) {
    code = createRoomCode();
  }

  const hostId = randomId("p");
  const hostToken = randomId("t");
  const now = Date.now();

  const room = {
    code,
    hostId,
    status: STATUS.LOBBY,
    settings: {
      ...DEFAULT_SETTINGS,
    },
    players: [
      {
        id: hostId,
        token: hostToken,
        name: hostName,
        joinedAt: now,
        socketId: null,
        connected: false,
      },
    ],
    rounds: [],
    currentRoundNo: 0,
    timer: {
      deadlineTs: null,
      intervalId: null,
    },
  };

  rooms.set(code, room);
  return { room, player: room.players[0] };
}

function getRoom(code) {
  return rooms.get((code || "").toUpperCase()) || null;
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function getRound(room) {
  return room.rounds[room.currentRoundNo - 1] || null;
}

function clearTimer(room) {
  if (room.timer.intervalId) {
    clearInterval(room.timer.intervalId);
  }
  room.timer.intervalId = null;
  room.timer.deadlineTs = null;
}

function roundSummary(round) {
  if (!round) return null;
  return {
    roundNo: round.roundNo,
    topicText: round.topicText,
    status: round.status,
    startedAt: round.startedAt,
    deadlineTs: round.deadlineTs,
    submissions: round.submissions,
    votes: round.votes,
    scoresComputed: round.scoresComputed,
    submittedCount: round.submissions.filter((s) => s.submittedAt).length,
    votedCount: round.voteSubmissions.size,
    totalVoters: round.totalVoters,
  };
}

function roomStateForPlayer(room, playerId) {
  const player = getPlayer(room, playerId);
  const round = getRound(room);

  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    settings: room.settings,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      connected: p.connected,
    })),
    currentRoundNo: room.currentRoundNo,
    rounds: room.rounds.map((r) => roundSummary(r)),
    you: player
      ? {
          id: player.id,
          token: player.token,
          name: player.name,
          isHost: player.id === room.hostId,
        }
      : null,
    nowTs: Date.now(),
    activeRound: roundSummary(round),
  };
}

function emitRoomState(room) {
  room.players.forEach((player) => {
    if (!player.socketId) return;
    io.to(player.socketId).emit("room:state", roomStateForPlayer(room, player.id));
  });
}

function emitSubmissionUpdated(room) {
  const round = getRound(room);
  if (!round) return;
  io.to(room.code).emit("submission:updated", {
    roundNo: round.roundNo,
    submittedCount: round.submissions.filter((s) => s.submittedAt).length,
    totalPlayers: room.players.length,
  });
}

function emitVoteUpdated(room) {
  const round = getRound(room);
  if (!round) return;
  io.to(room.code).emit("vote:updated", {
    roundNo: round.roundNo,
    votedCount: round.voteSubmissions.size,
    totalVoters: round.totalVoters,
  });
}

function computeScores(room) {
  const round = getRound(room);
  if (!round) return;

  const axisScoresByPlayer = Object.fromEntries(
    room.players.map((player) => [
      player.id,
      {
        NORM_CHALLENGE: 0,
        LOGIC_LEAP: 0,
        EMOTION_STIM: 0,
        ARTISTRY: 0,
      },
    ]),
  );

  round.votes.forEach((vote) => {
    const targetSubmission = round.submissions.find((sub) => sub.playerId === vote.submissionPlayerId);
    if (!targetSubmission) return;
    if (targetSubmission.isDisqualified) return;
    if (!axisScoresByPlayer[vote.submissionPlayerId]) return;
    axisScoresByPlayer[vote.submissionPlayerId][vote.axis] += SCORE_PER_VOTE;
  });

  const bySubmissionPlayerId = {};
  round.submissions.forEach((submission) => {
    const axisScores = axisScoresByPlayer[submission.playerId] || {
      NORM_CHALLENGE: 0,
      LOGIC_LEAP: 0,
      EMOTION_STIM: 0,
      ARTISTRY: 0,
    };
    const total = submission.isDisqualified
      ? 0
      : AXIS_KEYS.reduce((sum, axis) => sum + (axisScores[axis] || 0), 0);
    bySubmissionPlayerId[submission.playerId] = {
      axisScores,
      total,
      isDisqualified: submission.isDisqualified,
      dqReason: submission.dqReason,
      text: submission.isDisqualified ? null : submission.text,
      submittedAt: submission.submittedAt,
    };
  });

  room.players.forEach((player) => {
    if (!bySubmissionPlayerId[player.id]) {
      bySubmissionPlayerId[player.id] = {
        axisScores: {
          NORM_CHALLENGE: 0,
          LOGIC_LEAP: 0,
          EMOTION_STIM: 0,
          ARTISTRY: 0,
        },
        total: 0,
        isDisqualified: false,
        dqReason: null,
        text: null,
        submittedAt: null,
      };
    }
  });

  round.scoresComputed = {
    bySubmissionPlayerId,
  };
}

function toReveal(room, reason = "manual") {
  const round = getRound(room);
  if (!round) return;
  clearTimer(room);
  room.status = STATUS.REVEAL;
  round.status = STATUS.REVEAL;
  io.to(room.code).emit("reveal:ready", {
    roundNo: round.roundNo,
    reason,
  });
  emitRoomState(room);
}

function toScoring(room) {
  const round = getRound(room);
  if (!round) return;
  room.status = STATUS.SCORING;
  round.status = STATUS.SCORING;
  round.totalVoters = room.players.length;
  emitVoteUpdated(room);
  emitRoomState(room);
}

function toResult(room) {
  const round = getRound(room);
  if (!round) return;
  computeScores(room);
  room.status = STATUS.RESULT;
  round.status = STATUS.RESULT;
  io.to(room.code).emit("result:ready", {
    roundNo: round.roundNo,
    scoresComputed: round.scoresComputed,
  });
  emitRoomState(room);
}

function startRoundTimer(room) {
  const round = getRound(room);
  if (!round) return;
  clearTimer(room);

  room.timer.deadlineTs = round.deadlineTs;
  room.timer.intervalId = setInterval(() => {
    const now = Date.now();
    const remainingSec = Math.max(0, Math.ceil((round.deadlineTs - now) / 1000));

    io.to(room.code).emit("round:tick", {
      roundNo: round.roundNo,
      remainingSec,
      deadlineTs: round.deadlineTs,
      nowTs: now,
    });

    if (remainingSec <= 0) {
      toReveal(room, "timeout");
    }
  }, 1000);
}

function startRound(room, topicOverride) {
  if (room.status !== STATUS.LOBBY && room.status !== STATUS.RESULT) {
    throw new Error("今はラウンドを開始できません");
  }

  if (room.currentRoundNo >= room.settings.roundCount) {
    room.status = STATUS.ENDED;
    emitRoomState(room);
    return;
  }

  const roundNo = room.currentRoundNo + 1;
  const now = Date.now();
  const submissions = room.players.map((player) => ({
    playerId: player.id,
    text: "",
    submittedAt: null,
    isDisqualified: false,
    dqReason: null,
  }));

  const round = {
    roundNo,
    topicText: pickTopic(roundNo, topicOverride),
    status: STATUS.WRITING,
    startedAt: now,
    deadlineTs: now + room.settings.timeLimitSec * 1000,
    submissions,
    votes: [],
    voteSubmissions: new Map(),
    totalVoters: room.players.length,
    scoresComputed: {
      bySubmissionPlayerId: {},
    },
  };

  room.rounds.push(round);
  room.currentRoundNo = roundNo;
  room.status = STATUS.WRITING;
  startRoundTimer(room);
  emitSubmissionUpdated(room);
  emitRoomState(room);
}

function normalizeVotes(votesPayload) {
  const votes = [];
  AXIS_KEYS.forEach((axis) => {
    const targetPlayerId = votesPayload?.[axis] || null;
    if (!targetPlayerId) {
      throw new Error(`軸 ${axis} の投票先が未選択です`);
    }
    votes.push({ axis, submissionPlayerId: targetPlayerId });
  });
  return votes;
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ name }, ack) => {
    try {
      const playerName = (name || "Guest").trim().slice(0, 20) || "Guest";
      const { room, player } = createRoom(playerName);
      player.socketId = socket.id;
      player.connected = true;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);
      emitRoomState(room);
      ack?.({ ok: true, roomCode: room.code, playerToken: player.token });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "ルーム作成に失敗しました" });
    }
  });

  socket.on("room:join", ({ code, name, playerToken }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");

      let player = null;
      if (playerToken) {
        player = room.players.find((p) => p.token === playerToken) || null;
      }

      if (!player) {
        if (room.players.length >= PLAYER_LIMIT.MAX) {
          throw new Error("ルーム人数上限です");
        }
        const playerName = (name || "Guest").trim().slice(0, 20) || "Guest";
        player = {
          id: randomId("p"),
          token: randomId("t"),
          name: playerName,
          joinedAt: Date.now(),
          socketId: null,
          connected: false,
        };
        room.players.push(player);
      } else if (name && name.trim()) {
        player.name = name.trim().slice(0, 20);
      }

      player.socketId = socket.id;
      player.connected = true;

      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      socket.join(room.code);

      emitRoomState(room);
      emitSubmissionUpdated(room);
      emitVoteUpdated(room);
      ack?.({ ok: true, roomCode: room.code, playerToken: player.token });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "ルーム参加に失敗しました" });
    }
  });

  socket.on("room:getState", ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      const playerId = socket.data.playerId;
      if (!playerId) throw new Error("プレイヤー情報がありません");
      ack?.({ ok: true, state: roomStateForPlayer(room, playerId) });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "状態取得に失敗しました" });
    }
  });

  socket.on("room:updateSettings", ({ code, settings }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ設定可能です");
      if (room.status !== STATUS.LOBBY) throw new Error("ロビーでのみ変更可能です");

      const roundCount = Math.max(1, Math.min(10, Number(settings?.roundCount || room.settings.roundCount)));
      const timeLimitSec = Math.max(15, Math.min(180, Number(settings?.timeLimitSec || room.settings.timeLimitSec)));
      const anonymous = Boolean(settings?.anonymous);

      room.settings = { roundCount, timeLimitSec, anonymous };
      emitRoomState(room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "設定更新に失敗しました" });
    }
  });

  socket.on("round:start", ({ code, topicOverride }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ開始できます");
      if (room.players.length < PLAYER_LIMIT.MIN) {
        throw new Error(`最低${PLAYER_LIMIT.MIN}人必要です`);
      }
      startRound(room, topicOverride);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "ラウンド開始に失敗しました" });
    }
  });

  socket.on("submission:update", ({ code, text }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (room.status !== STATUS.WRITING) throw new Error("今は投稿できません");

      const round = getRound(room);
      if (!round) throw new Error("ラウンドがありません");
      const playerId = socket.data.playerId;
      const submission = round.submissions.find((s) => s.playerId === playerId);
      if (!submission) throw new Error("投稿対象が見つかりません");

      const normalizedText = (text || "").trim().slice(0, 280);
      const moderation = detectLineCrossing(normalizedText);
      submission.text = normalizedText;
      submission.submittedAt = normalizedText ? Date.now() : null;
      submission.isDisqualified = moderation.isDisqualified;
      submission.dqReason = moderation.reason;

      emitSubmissionUpdated(room);
      emitRoomState(room);
      ack?.({ ok: true, isDisqualified: submission.isDisqualified, dqReason: submission.dqReason });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "投稿更新に失敗しました" });
    }
  });

  socket.on("round:reveal", ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.WRITING) throw new Error("今は公開できません");
      toReveal(room, "host");
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "公開に失敗しました" });
    }
  });

  socket.on("scoring:start", ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.REVEAL) throw new Error("今は採点に進めません");
      toScoring(room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "採点開始に失敗しました" });
    }
  });

  socket.on("scoring:submitVotes", ({ code, votes }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (room.status !== STATUS.SCORING) throw new Error("今は採点できません");
      const round = getRound(room);
      if (!round) throw new Error("ラウンドがありません");

      const voterId = socket.data.playerId;
      const normalizedVotes = normalizeVotes(votes);

      normalizedVotes.forEach((vote) => {
        if (vote.submissionPlayerId === voterId) {
          throw new Error("自分には投票できません");
        }

        const targetSubmission = round.submissions.find((sub) => sub.playerId === vote.submissionPlayerId);
        if (!targetSubmission) {
          throw new Error("投票先が不正です");
        }

        if (targetSubmission.isDisqualified) {
          throw new Error("失格者には投票できません");
        }
      });

      round.votes = round.votes.filter((vote) => vote.voterId !== voterId);
      normalizedVotes.forEach((vote) => {
        round.votes.push({
          voterId,
          axis: vote.axis,
          submissionPlayerId: vote.submissionPlayerId,
        });
      });
      round.voteSubmissions.set(voterId, Date.now());

      emitVoteUpdated(room);
      emitRoomState(room);

      if (round.voteSubmissions.size >= round.totalVoters) {
        toResult(room);
      }

      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "投票送信に失敗しました" });
    }
  });

  socket.on("result:finalize", ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.SCORING) throw new Error("今は結果確定できません");
      toResult(room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "結果確定に失敗しました" });
    }
  });

  socket.on("round:next", ({ code, topicOverride }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.RESULT && room.status !== STATUS.LOBBY) {
        throw new Error("次ラウンドに進めません");
      }

      if (room.currentRoundNo >= room.settings.roundCount) {
        room.status = STATUS.ENDED;
        emitRoomState(room);
        ack?.({ ok: true, ended: true });
        return;
      }

      startRound(room, topicOverride);
      ack?.({ ok: true, ended: false });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "次ラウンドに失敗しました" });
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return;

    const room = getRoom(roomCode);
    if (!room) return;

    const player = getPlayer(room, playerId);
    if (!player) return;

    player.connected = false;
    player.socketId = null;
    emitRoomState(room);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[game-server] listening on http://localhost:${PORT}`);
});
