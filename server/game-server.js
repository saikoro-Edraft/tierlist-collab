import express from "express";
import http from "http";
import { Server } from "socket.io";
import {
  AXIS_KEYS,
  DEFAULT_SETTINGS,
  FIXED_TOPICS,
  PLAYER_LIMIT,
  STAR,
  STATUS,
} from "../src/game/constants.js";
import { detectLineCrossing } from "./moderation-config.js";

const PORT = Number(process.env.PORT || 8787);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);

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

function refillTopicDeck(room) {
  const indices = FIXED_TOPICS.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  room.topicDeck = indices;
}

function pickTopic(room, roundNo, overrideTopic) {
  if (overrideTopic && overrideTopic.trim()) return overrideTopic.trim();
  if (!FIXED_TOPICS.length) return `お題 ${roundNo}`;
  if (!Array.isArray(room.topicDeck) || room.topicDeck.length === 0) {
    refillTopicDeck(room);
  }

  const nextIndex = room.topicDeck.shift();
  if (!Number.isInteger(nextIndex) || !FIXED_TOPICS[nextIndex]) {
    return FIXED_TOPICS[Math.floor(Math.random() * FIXED_TOPICS.length)];
  }
  return FIXED_TOPICS[nextIndex];
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
    topicDeck: [],
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

function createEmptyAxisScore() {
  return Object.fromEntries(AXIS_KEYS.map((axis) => [axis, 0]));
}

function clampStar(value) {
  return Math.max(STAR.MIN, Math.min(STAR.MAX, Math.round(value)));
}

function evaluateArtistry(topicText, submissionText) {
  const text = (submissionText || "").trim();
  if (!text) return { stars: STAR.MIN, reason: "未提出" };

  let score = 2;
  if (text.length >= 30) score += 1;
  if (text.length >= 80) score += 1;
  if (/[！？!?\u300c\u300d]/u.test(text)) score += 0.5;
  if (/比喩|まるで|つまり|だが|しかし|けれど|なのに/u.test(text)) score += 0.5;
  if (topicText && text.includes(topicText.slice(0, 4))) score += 0.5;

  return {
    stars: clampStar(score),
    reason: "語彙・構成・お題接続をもとに推定",
  };
}

function evaluateLineCrossingLevel(submissionText) {
  const text = (submissionText || "").trim();
  if (!text) return { stars: STAR.MIN, reason: "未提出" };
  const moderation = detectLineCrossing(text);
  if (moderation.isDisqualified) {
    return {
      stars: STAR.MAX,
      reason: moderation.reason || "重大な不適切表現を検知",
      forcedDisqualify: true,
    };
  }

  let score = 1;
  if (/炎上|煽り|挑発|喧嘩/u.test(text)) score += 1;
  if (/死|殺|住所|電話|晒す|差別/u.test(text)) score += 2;
  if (/絶対|全員|二度と/u.test(text)) score += 0.5;

  return {
    stars: clampStar(score),
    reason: "攻撃性・挑発性をもとに推定",
    forcedDisqualify: false,
  };
}

function parseJsonObject(text) {
  if (!text || typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function toReviewComment(text) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return "着眼点は良いが精度に改善余地あり";
  const chars = Array.from(raw);
  if (chars.length <= 34) return raw;
  return `${chars.slice(0, 33).join("")}…`;
}

async function requestOpenAiJudgements({ topicText, submissions }) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ai_judgements",
            schema: {
              type: "object",
              properties: {
                judgements: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      playerId: { type: "string" },
                      artistryStars: { type: "integer", minimum: STAR.MIN, maximum: STAR.MAX },
                      lineCrossingStars: { type: "integer", minimum: STAR.MIN, maximum: STAR.MAX },
                      isDisqualified: { type: "boolean" },
                      dqReason: { type: "string" },
                      comment: { type: "string" },
                    },
                    required: [
                      "playerId",
                      "artistryStars",
                      "lineCrossingStars",
                      "isDisqualified",
                      "dqReason",
                      "comment",
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ["judgements"],
              additionalProperties: false,
            },
            strict: true,
          },
        },
        messages: [
          {
            role: "system",
            content: [
              "あなたはパーティーゲームの採点AIです。",
              "お題とプレイヤーの提出テキストをもとに、お題に対する返しのうまさである芸術性と",
              "aiが独自に判断する不適切表現の有無であるライン越え度を1〜5の星評価で採点してください。",
              "以下を守ってJSONのみ返してください。",
              "- artistryStars: 芸術性 1〜5",
              "- lineCrossingStars: ライン越え度 1〜5",
              "- isDisqualified:  ライン越え度5なら true",
              "- dqReason: 失格理由（失格でない場合は空文字）",
              "- comment: AIの講評。日本語30文字程度",
              "- topicText への適合度を artistryStars に必ず反映すること",
              "- topicText から逸脱した回答は artistryStars を最大2までに抑えること",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              topicText,
              submissions,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${bodyText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = parseJsonObject(content);
    if (!parsed || !Array.isArray(parsed.judgements)) {
      throw new Error("OpenAI response JSON parse failed");
    }

    const byPlayerId = Object.fromEntries(
      parsed.judgements.map((judge) => [
        judge.playerId,
        {
          artistryStars: clampStar(judge.artistryStars),
          lineCrossingStars: clampStar(judge.lineCrossingStars),
          isDisqualified: Boolean(judge.isDisqualified),
          dqReason: String(judge.dqReason || ""),
          comment: toReviewComment(judge.comment),
        },
      ]),
    );
    return byPlayerId;
  } finally {
    clearTimeout(timeoutId);
  }
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
    nonHostVotedCount: round.nonHostVotedCount ?? 0,
    totalVoters: round.totalVoters,
  };
}

function getNonHostVotedCount(room, round) {
  if (!round) return 0;
  let count = 0;
  round.voteSubmissions.forEach((_submittedAt, voterId) => {
    if (voterId !== room.hostId) {
      count += 1;
    }
  });
  return count;
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
  const nonHostVotedCount = getNonHostVotedCount(room, round);
  round.nonHostVotedCount = nonHostVotedCount;
  io.to(room.code).emit("vote:updated", {
    roundNo: round.roundNo,
    votedCount: round.voteSubmissions.size,
    nonHostVotedCount,
    nonHostTotal: Math.max(0, room.players.length - 1),
    totalVoters: round.totalVoters,
  });
}

function computeScores(room) {
  const round = getRound(room);
  if (!round) return;
  const submissionByPlayer = Object.fromEntries(
    round.submissions.map((submission) => [submission.playerId, submission]),
  );

  const axisScoresByPlayer = Object.fromEntries(
    room.players.map((player) => [
      player.id,
      createEmptyAxisScore(),
    ]),
  );

  round.votes.forEach((vote) => {
    const targetSubmission = submissionByPlayer[vote.submissionPlayerId] || null;
    if (!targetSubmission) return;
    if (targetSubmission.isDisqualified) return;
    if (!axisScoresByPlayer[vote.submissionPlayerId]) return;
    axisScoresByPlayer[vote.submissionPlayerId][vote.axis] += vote.stars;
  });

  const bySubmissionPlayerId = {};
  round.submissions.forEach((submission) => {
    const axisScores = axisScoresByPlayer[submission.playerId] || createEmptyAxisScore();
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
        axisScores: createEmptyAxisScore(),
        total: 0,
        isDisqualified: false,
        dqReason: null,
        text: null,
        submittedAt: null,
      };
    }
  });

  round.scoresComputed = {
    judgedBy: "player",
    bySubmissionPlayerId,
  };
}

async function computeAiScores(room) {
  const round = getRound(room);
  if (!round) return;

  const aiInputSubmissions = round.submissions.map((submission) => ({
    playerId: submission.playerId,
    text: submission.text || "",
  }));

  let aiJudgementsByPlayerId = null;
  let judgedByModel = "heuristic-fallback";
  try {
    aiJudgementsByPlayerId = await requestOpenAiJudgements({
      topicText: round.topicText,
      submissions: aiInputSubmissions,
    });
    judgedByModel = OPENAI_MODEL;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn("[ai] OpenAI scoring failed, fallback to heuristic:", error?.message || error);
  }

  const bySubmissionPlayerId = {};
  round.submissions.forEach((submission) => {
    const ai = aiJudgementsByPlayerId?.[submission.playerId] || null;
    const lineEval = ai
      ? {
          stars: clampStar(ai.lineCrossingStars),
          reason: ai.comment || "AI判定",
          forcedDisqualify: Boolean(ai.isDisqualified),
        }
      : evaluateLineCrossingLevel(submission.text);
    const artEval = ai
      ? {
          stars: clampStar(ai.artistryStars),
          reason: ai.comment || "AI判定",
        }
      : evaluateArtistry(round.topicText, submission.text);
    const moderation = detectLineCrossing(submission.text || "");
    const forcedDisqualify = Boolean(lineEval.forcedDisqualify || moderation.isDisqualified || ai?.isDisqualified);
    const isDisqualified = Boolean(submission.isDisqualified || forcedDisqualify);

    if (forcedDisqualify) {
      submission.isDisqualified = true;
      submission.dqReason =
        submission.dqReason
        || moderation.reason
        || ai?.dqReason
        || lineEval.reason
        || "冗談では許されない表現";
    }

    const axisScores = createEmptyAxisScore();
    axisScores.ARTISTRY = isDisqualified ? 0 : artEval.stars;
    axisScores.LINE_CROSSING = lineEval.stars;

    bySubmissionPlayerId[submission.playerId] = {
      axisScores,
      total: isDisqualified ? 0 : axisScores.ARTISTRY + axisScores.LINE_CROSSING,
      isDisqualified,
      dqReason: submission.dqReason || null,
      text: isDisqualified ? null : submission.text,
      submittedAt: submission.submittedAt,
      aiComment: toReviewComment(ai?.comment || `芸術性:${artEval.reason} ライン越え度:${lineEval.reason}`),
    };
  });

  room.players.forEach((player) => {
    if (!bySubmissionPlayerId[player.id]) {
      bySubmissionPlayerId[player.id] = {
        axisScores: createEmptyAxisScore(),
        total: 0,
        isDisqualified: false,
        dqReason: null,
        text: null,
        submittedAt: null,
        aiComment: "投稿なしのため評価コメントなし",
      };
    }
  });

  round.scoresComputed = {
    judgedBy: "ai",
    judgedByModel,
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
  round.nonHostVotedCount = 0;
  emitVoteUpdated(room);
  emitRoomState(room);
}

async function toResult(room, mode = "player") {
  const round = getRound(room);
  if (!round) return;
  if (mode === "ai") {
    await computeAiScores(room);
  } else {
    computeScores(room);
  }
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
    topicText: pickTopic(room, roundNo, topicOverride),
    status: STATUS.WRITING,
    startedAt: now,
    deadlineTs: now + room.settings.timeLimitSec * 1000,
    submissions,
    votes: [],
    voteSubmissions: new Map(),
    totalVoters: room.players.length,
    nonHostVotedCount: 0,
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

function normalizeVotes(votesPayload, options = {}) {
  const {
    allowEmpty = false,
    fallbackTargetPlayerId = null,
  } = options;
  if (allowEmpty) return [];
  const votes = [];
  AXIS_KEYS.forEach((axis) => {
    const row = votesPayload?.[axis] || null;
    const targetPlayerId = row?.submissionPlayerId || fallbackTargetPlayerId || null;
    const stars = Number(row?.stars);
    if (!targetPlayerId) {
      throw new Error(`軸 ${axis} の投票先が未選択です`);
    }
    if (!Number.isInteger(stars) || stars < STAR.MIN || stars > STAR.MAX) {
      throw new Error(`軸 ${axis} の星評価は ${STAR.MIN}〜${STAR.MAX} で選択してください`);
    }
    votes.push({ axis, submissionPlayerId: targetPlayerId, stars });
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
      const scoringMode = settings?.scoringMode === "ai" ? "ai" : "player";

      room.settings = { roundCount, timeLimitSec, anonymous, scoringMode };
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
      if (room.settings.scoringMode === "ai") throw new Error("AI採点モードでは手動採点は不要です");
      toScoring(room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "採点開始に失敗しました" });
    }
  });

  socket.on("scoring:runAi", async ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.REVEAL) throw new Error("今はAI採点を実行できません");
      if (room.settings.scoringMode !== "ai") throw new Error("プレイヤー採点モードです");
      await toResult(room, "ai");
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "AI採点に失敗しました" });
    }
  });

  socket.on("scoring:submitVotes", async ({ code, votes }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (room.status !== STATUS.SCORING) throw new Error("今は採点できません");
      if (room.settings.scoringMode === "ai") throw new Error("AI採点モードでは手動投票できません");
      const round = getRound(room);
      if (!round) throw new Error("ラウンドがありません");

      const voterId = socket.data.playerId;
      const isHostVoter = voterId === room.hostId;
      if (isHostVoter) {
        const nonHostVotedCount = getNonHostVotedCount(room, round);
        const nonHostTotal = Math.max(0, room.players.length - 1);
        if (nonHostVotedCount < nonHostTotal) {
          throw new Error("ホストはメンバー投票完了後に投票できます");
        }
      }
      const eligibleTargets = room.players.filter((player) => {
        if (player.id === voterId) return false;
        const submission = round.submissions.find((sub) => sub.playerId === player.id);
        return !submission?.isDisqualified;
      });
      const fallbackTargetPlayerId =
        room.players.length === 2 && eligibleTargets.length === 1
          ? eligibleTargets[0].id
          : null;
      const normalizedVotes = normalizeVotes(votes, {
        allowEmpty: eligibleTargets.length === 0,
        fallbackTargetPlayerId,
      });

      normalizedVotes.forEach((vote) => {
        if (vote.submissionPlayerId === voterId) {
          throw new Error("自分には投票できません");
        }

        const targetPlayerId = vote.submissionPlayerId || fallbackTargetPlayerId;
        const targetPlayer = room.players.find((player) => player.id === targetPlayerId);
        if (!targetPlayer) {
          throw new Error("投票先が不正です");
        }

        const targetSubmission = round.submissions.find((sub) => sub.playerId === targetPlayerId);
        if (targetSubmission?.isDisqualified) {
          throw new Error("失格者には投票できません");
        }
        vote.submissionPlayerId = targetPlayerId;
      });

      round.votes = round.votes.filter((vote) => vote.voterId !== voterId);
      normalizedVotes.forEach((vote) => {
        round.votes.push({
          voterId,
          axis: vote.axis,
          submissionPlayerId: vote.submissionPlayerId,
          stars: vote.stars,
        });
      });
      round.voteSubmissions.set(voterId, Date.now());

      emitVoteUpdated(room);
      emitRoomState(room);

      if (round.voteSubmissions.size >= round.totalVoters) {
        await toResult(room, "player");
      }

      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "投票送信に失敗しました" });
    }
  });

  socket.on("result:finalize", async ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");
      if (room.status !== STATUS.SCORING) throw new Error("今は結果確定できません");
      await toResult(room, room.settings.scoringMode === "ai" ? "ai" : "player");
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

  socket.on("game:backToLobby", ({ code }, ack) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("ルームが見つかりません");
      if (socket.data.playerId !== room.hostId) throw new Error("ホストのみ操作できます");

      clearTimer(room);
      room.status = STATUS.LOBBY;
      room.currentRoundNo = 0;
      room.rounds = [];
      room.topicDeck = [];
      emitRoomState(room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error.message || "ロビーへの復帰に失敗しました" });
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
