import "./styles/app.css";
import { io } from "socket.io-client";
import { AXES, STATUS } from "./game/constants.js";
import { renderGameApp } from "./ui/render.js";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8787";

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
    votesDraft: Object.fromEntries(AXES.map((axis) => [axis.key, ""])),
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
  return window.localStorage.getItem(tokenKey(code));
}

function setStoredAuth(code, token, name) {
  if (!code || !token) return;
  window.localStorage.setItem(tokenKey(code), token);
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
    socket.emit(event, payload, (response) => {
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

  if (state.room.activeRound) {
    const mySubmission = state.room.activeRound.submissions?.find(
      (submission) => submission.playerId === state.you?.id,
    );
    if (mySubmission && state.room.status === STATUS.WRITING) {
      state.ui.submissionText = mySubmission.text || "";
    }
  }
}

function render() {
  if (!root) return;
  renderGameApp(root, state, handlers);
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
  state.room = roomState;
  state.you = roomState.you;
  syncDraftFromRoom();
  ensureRoutePhaseByRoom();
  render();
});

socket.on("round:tick", (payload) => {
  state.roundTick = payload;
  render();
});

socket.on("submission:updated", () => {
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
    state.ui.votesDraft = Object.fromEntries(AXES.map((axis) => [axis.key, ""]));
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
    state.ui.votesDraft = Object.fromEntries(AXES.map((axis) => [axis.key, ""]));
    setHashRoute(null, null);
    render();
  },
  onChangeUi: (field, value) => {
    state.ui[field] = value;
  },
  onVoteDraft: (axisKey, playerId) => {
    state.ui.votesDraft[axisKey] = playerId;
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
  onUpdateSettings: async () => {
    if (!state.room) return;
    const payload = {
      roundCount: Number(state.ui.roundCountDraft || state.room.settings.roundCount),
      timeLimitSec: Number(state.ui.timeLimitDraft || state.room.settings.timeLimitSec),
      anonymous: Boolean(state.ui.anonymousDraft),
    };
    const res = await rpc("room:updateSettings", {
      code: state.room.code,
      settings: payload,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "設定更新に失敗しました");
      return;
    }
    window.__toast?.success("設定を更新しました");
  },
  onStartRound: async () => {
    if (!state.room) return;
    const res = await rpc("round:start", {
      code: state.room.code,
      topicOverride: state.ui.topicOverride,
    });
    if (!res.ok) {
      window.__toast?.error(res.message || "ラウンド開始に失敗しました");
      return;
    }
    state.ui.submissionText = "";
    state.ui.votesDraft = Object.fromEntries(AXES.map((axis) => [axis.key, ""]));
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
      window.__toast?.error(`失格判定: ${res.dqReason || "規約違反"}`);
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
  onSubmitVotes: async () => {
    if (!state.room) return;
    const missing = AXES.some((axis) => !state.ui.votesDraft[axis.key]);
    if (missing) {
      window.__toast?.error("4軸すべて選択してください");
      return;
    }
    const res = await rpc("scoring:submitVotes", {
      code: state.room.code,
      votes: state.ui.votesDraft,
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
    state.ui.votesDraft = Object.fromEntries(AXES.map((axis) => [axis.key, ""]));
  },
};

state.ui.homeName = getStoredName(state.route.code) || "";
state.ui.joinCode = state.route.code || "";
state.ui.joinName = getStoredName(state.route.code) || "";

render();

if (state.route.code) {
  attemptJoinFromRoute();
}
