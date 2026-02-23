import "./styles/app.css";
import { io } from "socket.io-client";
import { AXES, STATUS } from "./game/constants.js";
import { renderGameApp } from "./ui/render.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8787";
const QUIZ_TOPIC_SOUND_URL = new URL("./assets/sound/クイズ出題1.mp3", import.meta.url).href;
const REVEAL_SOUND_URL = new URL("./assets/sound/拍子木2.mp3", import.meta.url).href;
const WINNER_SOUND_URL = new URL("./assets/sound/ジャジャーン1.mp3", import.meta.url).href;

const PHASE_BY_STATUS = {
  [STATUS.LOBBY]: "lobby",
  [STATUS.WRITING]: "round",
  [STATUS.REVEAL]: "reveal",
  [STATUS.SCORING]: "score",
  [STATUS.RESULT]: "result",
  [STATUS.ENDED]: "result",
};

const state = {
  route: parseHash(),
  connectionState: "connecting",
  room: null,
  you: null,
  roundTick: {
    remainingSec: null,
    deadlineTs: null,
    nowTs: null,
  },
  ui: {
    homeName: "",
    joinCode: "",
    joinName: "",
    topicOverride: "",
    submissionText: "",
    roundCountDraft: null,
    timeLimitDraft: null,
    anonymousDraft: null,
    scoringModeDraft: null,
    votesDraft: Object.fromEntries(
      AXES.map((axis) => [axis.key, { submissionPlayerId: "", stars: "" }]),
    ),
  },
  meta: {
    syncedSubmissionRound: null,
    playedTopicRoundNos: new Set(),
    playedRevealRoundNos: new Set(),
    playedFinalResultRound: null,
    revealTimers: [],
  },
};

const root = document.getElementById("app");
const socket = io(SOCKET_URL, {
  autoConnect: true,
  transports: ["websocket", "polling"],
  reconnection: true,
});

function parseHash() {
  const hash = window.location.hash.replace(/^#/, "") || "/";
  const parts = hash.split("/").filter(Boolean);
  if (parts.length >= 2 && parts[0] === "room") {
    return {
      code: (parts[1] || "").toUpperCase(),
      phase: parts[2] || "lobby",
    };
  }
  return {
    code: null,
    phase: null,
  };
}

function setHashRoute(code, phase) {
  const next = code ? `#/room/${code}/${phase}` : "#/";
  if (window.location.hash === next) return;
  window.location.hash = next;
}

function tokenKey(code) {
  return `on_fire_game_token_${code}`;
}

function nameKey(code) {
  return `on_fire_game_name_${code}`;
}

function getStoredToken(code) {
  if (!code) return null;
  return window.sessionStorage.getItem(tokenKey(code));
}

function setStoredAuth(code, token, name) {
  if (!code || !token) return;
  window.sessionStorage.setItem(tokenKey(code), token);
  if (name) {
    window.localStorage.setItem(nameKey(code), name);
  }
}

function getStoredName(code) {
  if (!code) return "";
  return window.localStorage.getItem(nameKey(code)) || "";
}

function rpc(event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, message: `${event} がタイムアウトしました` });
    }, 5000);
    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(response || { ok: false, message: "サーバ応答がありません" });
    });
  });
}

function ensureRoutePhaseByRoom() {
  if (!state.room?.code) return;
  const expectedPhase = PHASE_BY_STATUS[state.room.status] || "lobby";
  if (state.route.code !== state.room.code || state.route.phase !== expectedPhase) {
    setHashRoute(state.room.code, expectedPhase);
  }
}

function syncDraftFromRoom() {
  if (!state.room) return;

  if (state.ui.roundCountDraft == null) {
    state.ui.roundCountDraft = state.room.settings.roundCount;
  }
  if (state.ui.timeLimitDraft == null) {
    state.ui.timeLimitDraft = state.room.settings.timeLimitSec;
  }
  if (state.ui.anonymousDraft == null) {
    state.ui.anonymousDraft = state.room.settings.anonymous;
  }
  if (state.ui.scoringModeDraft == null) {
    state.ui.scoringModeDraft = state.room.settings.scoringMode || "player";
  }

  if (state.room.activeRound) {
    const roundNo = state.room.activeRound.roundNo;
    const mySubmission = state.room.activeRound.submissions?.find(
      (submission) => submission.playerId === state.you?.id,
    );
    const inputFocused = document.activeElement?.dataset?.role === "submission-input";
    if (
      mySubmission &&
      state.room.status === STATUS.WRITING &&
      state.meta.syncedSubmissionRound !== roundNo &&
      !inputFocused
    ) {
      state.ui.submissionText = mySubmission.text || "";
      state.meta.syncedSubmissionRound = roundNo;
    }
  }
}

function render() {
  if (!root) return;
  renderGameApp(root, state, handlers);
}

function playSound(url) {
  const audio = new Audio(url);
  audio.play().catch(() => {
    // Autoplay policy or missing asset is non-fatal.
  });
}

function clearRevealTimers() {
  state.meta.revealTimers.forEach((timerId) => clearTimeout(timerId));
  state.meta.revealTimers = [];
}

function isFinalResultState(room) {
  if (!room) return false;
  const isResultPhase = room.status === STATUS.RESULT || room.status === STATUS.ENDED;
  if (!isResultPhase) return false;
  return room.currentRoundNo >= room.settings.roundCount;
}

function playFinalResultSoundOnce(room) {
  if (!isFinalResultState(room)) return;
  const roundNo = Number(room.currentRoundNo || 0);
  if (!roundNo) return;
  if (state.meta.playedFinalResultRound === roundNo) return;
  state.meta.playedFinalResultRound = roundNo;
  playSound(WINNER_SOUND_URL);
}

function playTopicSoundOnRoundStart(prevRoom, nextRoom) {
  if (!nextRoom || nextRoom.status !== STATUS.WRITING) return;
  const roundNo = Number(nextRoom.currentRoundNo || 0);
  if (!roundNo) return;
  const enteredWriting =
    !prevRoom
    || prevRoom.status !== STATUS.WRITING
    || Number(prevRoom.currentRoundNo || 0) !== roundNo;
  if (!enteredWriting) return;
  if (state.meta.playedTopicRoundNos.has(roundNo)) return;

  state.meta.playedTopicRoundNos.add(roundNo);
  playSound(QUIZ_TOPIC_SOUND_URL);
}

function playRevealSoundsOnEnter(prevRoom, nextRoom) {
  if (!nextRoom) return;
  if (nextRoom.status !== STATUS.REVEAL) {
    clearRevealTimers();
    return;
  }
  const roundNo = Number(nextRoom.currentRoundNo || 0);
  if (!roundNo) return;
  const enteredReveal =
    !prevRoom
    || prevRoom.status !== STATUS.REVEAL
    || Number(prevRoom.currentRoundNo || 0) !== roundNo;
  if (!enteredReveal) return;
  if (state.meta.playedRevealRoundNos.has(roundNo)) return;

  state.meta.playedRevealRoundNos.add(roundNo);
  clearRevealTimers();
  playSound(REVEAL_SOUND_URL);
}

function emptyVotesDraft() {
  return Object.fromEntries(
    AXES.map((axis) => [axis.key, { submissionPlayerId: "", stars: "" }]),
  );
}

function hasVotingTargets() {
  return getEligibleVotingTargets().length > 0;
}

function getEligibleVotingTargets() {
  if (!state.room?.activeRound || !state.you) return [];
  const submissionByPlayerId = Object.fromEntries(
    state.room.activeRound.submissions.map((submission) => [submission.playerId, submission]),
  );
  return state.room.players.filter((player) => {
    if (player.id === state.you.id) return false;
    if (submissionByPlayerId[player.id]?.isDisqualified) return false;
    return true;
  });
}

function normalizeVotesForSubmit() {
  const targets = getEligibleVotingTargets();
  const isTwoPlayerMode = state.room?.players?.length === 2;

  if (targets.length === 0) return {};

  if (isTwoPlayerMode && targets.length === 1) {
    const targetId = targets[0].id;
    return Object.fromEntries(
      AXES.map((axis) => [
        axis.key,
        {
          submissionPlayerId: targetId,
          stars: Number(state.ui.votesDraft[axis.key]?.stars),
        },
      ]),
    );
  }

  return Object.fromEntries(
    AXES.map((axis) => [
      axis.key,
      {
        submissionPlayerId: state.ui.votesDraft[axis.key]?.submissionPlayerId || "",
        stars: Number(state.ui.votesDraft[axis.key]?.stars),
      },
    ]),
  );
}

function canHostVoteNow() {
  if (!state.room?.activeRound || !state.you?.isHost) return true;
  const nonHostVotedCount = Number(state.room.activeRound.nonHostVotedCount || 0);
  const nonHostTotal = Math.max(0, state.room.players.length - 1);
  return nonHostVotedCount >= nonHostTotal;
}

async function attemptJoinFromRoute() {
  const route = state.route;
  if (!route.code) return;
  const token = getStoredToken(route.code);
  const name = state.ui.joinName || getStoredName(route.code) || state.ui.homeName || "Guest";

  const res = await rpc("room:join", {
    code: route.code,
    name,
    playerToken: token,
  });

  if (!res.ok) {
    if (window.__toast) {
      window.__toast.error(res.message || "ルーム参加に失敗しました");
    }
    return;
  }

  setStoredAuth(route.code, res.playerToken, name);
}

socket.on("connect", async () => {
  state.connectionState = "connected";
  render();
  if (state.route.code) {
    await attemptJoinFromRoute();
  }
});

socket.on("disconnect", () => {
  state.connectionState = "reconnecting";
  render();
});

socket.on("reconnect_attempt", () => {
  state.connectionState = "reconnecting";
  render();
});

socket.on("room:state", (roomState) => {
  const prevRoom = state.room;
  if (roomState?.status === STATUS.LOBBY) {
    clearRevealTimers();
    state.meta.playedTopicRoundNos.clear();
    state.meta.playedRevealRoundNos.clear();
    state.meta.playedFinalResultRound = null;
  }
  playTopicSoundOnRoundStart(prevRoom, roomState);
  playRevealSoundsOnEnter(prevRoom, roomState);
  state.room = roomState;
  state.you = roomState.you;
  syncDraftFromRoom();
  playFinalResultSoundOnce(roomState);
  ensureRoutePhaseByRoom();
  render();
});

socket.on("round:tick", (payload) => {
  state.roundTick = payload;
  const timer = document.querySelector("[data-role='remaining-sec']");
  if (timer) {
    timer.textContent = String(payload.remainingSec ?? "--");
    return;
  }
  render();
});

socket.on("submission:updated", (payload) => {
  const submitted = document.querySelector("[data-role='submitted-count']");
  if (submitted && typeof payload?.submittedCount === "number" && typeof payload?.totalPlayers === "number") {
    submitted.textContent = `提出済み: ${payload.submittedCount}/${payload.totalPlayers}`;
    return;
  }
  render();
});

socket.on("vote:updated", () => {
  render();
});

socket.on("reveal:ready", () => {
  if (window.__toast) window.__toast.success("一斉公開に進みました");
});

socket.on("result:ready", () => {
  if (window.__toast) window.__toast.success("結果を表示します");
});

window.addEventListener("hashchange", async () => {
  state.route = parseHash();
  if (!state.route.code) {
    state.room = null;
    state.you = null;
    state.ui.votesDraft = emptyVotesDraft();
    render();
    return;
  }

  if (!state.room || state.room.code !== state.route.code) {
    await attemptJoinFromRoute();
  }

  render();
});

const handlers = {
  onBackHome: () => {
    state.route = { code: null, phase: null };
    state.room = null;
    state.you = null;
    state.ui.submissionText = "";
    state.ui.votesDraft = emptyVotesDraft();
    state.meta.syncedSubmissionRound = null;
    clearRevealTimers();
    state.meta.playedTopicRoundNos.clear();
    state.meta.playedRevealRoundNos.clear();
    state.meta.playedFinalResultRound = null;
    setHashRoute(null, null);
    render();
  },
  onChangeUi: (field, value) => {
    state.ui[field] = value;
  },
  onCopyRoomCode: async () => {
    if (!state.room?.code) return;
    try {
      await navigator.clipboard.writeText(state.room.code);
      window.__toast?.success(`ルームコードをコピーしました: ${state.room.code}`);
    } catch {
      window.__toast?.error("ルームコードのコピーに失敗しました");
    }
  },
  onVoteDraft: (axisKey, patch) => {
    state.ui.votesDraft[axisKey] = {
      ...state.ui.votesDraft[axisKey],
      ...patch,
    };
    render();
  },
  onCreateRoom: async () => {
    const name = (state.ui.homeName || "Guest").trim() || "Guest";
    const res = await rpc("room:create", { name });
    if (!res.ok) {
      window.__toast?.error(res.message || "ルーム作成に失敗しました");
      return;
    }
    setStoredAuth(res.roomCode, res.playerToken, name);
    setHashRoute(res.roomCode, "lobby");
    state.route = parseHash();
    state.ui.joinCode = res.roomCode;
    state.ui.joinName = name;
    render();
  },
  onJoinRoom: async () => {
    const code = (state.ui.joinCode || "").trim().toUpperCase();
    const name = (state.ui.joinName || "Guest").trim() || "Guest";
    if (!code) {
      window.__toast?.error("ルームコードを入力してください");
      return;
    }

    const res = await rpc("room:join", {
      code,
      name,
      playerToken: getStoredToken(code),
    });

    if (!res.ok) {
      window.__toast?.error(res.message || "ルーム参加に失敗しました");
      return;
    }

    setStoredAuth(code, res.playerToken, name);
    setHashRoute(code, "lobby");
    state.route = parseHash();
    render();
  },
  onUpdateSettings: async ({ silent = false } = {}) => {
    if (!state.room) return;
    const anonymousValue = state.ui.anonymousDraft == null
      ? state.room.settings.anonymous
      : Boolean(state.ui.anonymousDraft);
    const payload = {
      roundCount: Number(state.ui.roundCountDraft || state.room.settings.roundCount),
      timeLimitSec: Number(state.ui.timeLimitDraft || state.room.settings.timeLimitSec),
      anonymous: anonymousValue,
      scoringMode: state.ui.scoringModeDraft || state.room.settings.scoringMode || "player",
    };
    const res = await rpc("room:updateSettings", {
      code: state.room.code,
      settings: payload,
    });
    if (!res.ok) {
      if (!silent) {
        window.__toast?.error(res.message || "設定更新に失敗しました");
      }
      return res;
    }
    if (!silent) {
      window.__toast?.success("設定を更新しました");
    }
    return res;
  },
  onStartRound: async () => {
    if (!state.room) return;
    const settingsRes = await handlers.onUpdateSettings({ silent: true });
    if (!settingsRes?.ok) return;
    const res = await rpc("round:start", {
      code: state.room.code,
      topicOverride: state.ui.topicOverride,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "ラウンド開始に失敗しました");
      return;
    }
    state.ui.submissionText = "";
    state.ui.votesDraft = emptyVotesDraft();
    state.meta.syncedSubmissionRound = null;
  },
  onSubmitWriting: async () => {
    if (!state.room) return;
    const res = await rpc("submission:update", {
      code: state.room.code,
      text: state.ui.submissionText,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "投稿に失敗しました");
      return;
    }
    if (res.isDisqualified) {
      window.__toast?.error("失格判定済み。公開時は本文がマスクされます。");
    } else {
      window.__toast?.success("投稿を更新しました");
    }
  },
  onForceReveal: async () => {
    if (!state.room) return;
    const res = await rpc("round:reveal", {
      code: state.room.code,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "公開に失敗しました");
    }
  },
  onStartScoring: async () => {
    if (!state.room) return;
    const res = await rpc("scoring:start", {
      code: state.room.code,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "採点開始に失敗しました");
    }
  },
  onRunAiScoring: async () => {
    if (!state.room) return;
    const res = await rpc("scoring:runAi", {
      code: state.room.code,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "AI採点に失敗しました");
      return;
    }
    window.__toast?.success("AI採点を実行しました");
  },
  onSubmitVotes: async () => {
    if (!state.room) return;
    const isTwoPlayerMode = state.room.players.length === 2;
    if (state.you?.isHost && !canHostVoteNow()) {
      window.__toast?.error("ホストはメンバー投票完了後に投票できます");
      return;
    }
    const canVote = hasVotingTargets();
    const missingTarget = canVote && !isTwoPlayerMode && AXES.some((axis) => !state.ui.votesDraft[axis.key]?.submissionPlayerId);
    const missingStars = canVote && AXES.some((axis) => !state.ui.votesDraft[axis.key]?.stars);
    const missing = missingTarget || missingStars;
    if (missing) {
      window.__toast?.error("すべての観点で投票先と星を入力してください");
      return;
    }
    const payloadVotes = normalizeVotesForSubmit();
    const res = await rpc("scoring:submitVotes", {
      code: state.room.code,
      votes: payloadVotes,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "投票送信に失敗しました");
      return;
    }
    window.__toast?.success("投票を送信しました");
  },
  onFinalizeResult: async () => {
    if (!state.room) return;
    const res = await rpc("result:finalize", {
      code: state.room.code,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "結果確定に失敗しました");
    }
  },
  onNextRound: async () => {
    if (!state.room) return;
    const res = await rpc("round:next", {
      code: state.room.code,
      topicOverride: state.ui.topicOverride,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "次ラウンド開始に失敗しました");
      return;
    }
    state.ui.submissionText = "";
    state.ui.votesDraft = emptyVotesDraft();
    state.meta.syncedSubmissionRound = null;
  },
  onBackToLobby: async () => {
    if (!state.room) return;
    const roomCode = state.room.code;
    state.ui.submissionText = "";
    state.ui.votesDraft = emptyVotesDraft();
    state.meta.syncedSubmissionRound = null;
    clearRevealTimers();
    state.meta.playedTopicRoundNos.clear();
    state.meta.playedRevealRoundNos.clear();
    state.meta.playedFinalResultRound = null;
    if (state.room) {
      state.room.status = STATUS.LOBBY;
      state.room.currentRoundNo = 0;
      state.room.activeRound = null;
      state.room.rounds = [];
    }
    setHashRoute(roomCode, "lobby");
    state.route = parseHash();
    render();

    const res = await rpc("game:backToLobby", {
      code: roomCode,
    });
    if (!res.ok) {
      window.__toast?.error(`${res.message || "ロビーへ戻れませんでした"}（サーバを再起動してください）`);
      return;
    }
    window.__toast?.success("ロビーへ戻りました");
  },
};

state.ui.homeName = getStoredName(state.route.code) || "";
state.ui.joinCode = state.route.code || "";
state.ui.joinName = getStoredName(state.route.code) || "";

render();

if (state.route.code) {
  attemptJoinFromRoute();
}
