import titleLogo from "../assets/title.png";
import { AXES, STATUS } from "../game/constants.js";

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function mountToast() {
  const toasts = el("div", "toasts");
  const toast = (type, message) => {
    const item = el("div", `toast toast--${type}`, message);
    toasts.append(item);
    setTimeout(() => item.remove(), 3000);
  };

  window.__toast = {
    success: (message) => toast("success", message),
    error: (message) => toast("error", message),
  };

  return toasts;
}

function renderHeader(onBackHome) {
  const header = el("header", "header");
  const left = el("div", "header__left");
  const brand = el("button", "brand brand--button");
  brand.type = "button";
  brand.addEventListener("click", onBackHome);

  const brandImg = document.createElement("img");
  brandImg.className = "brand__img";
  brandImg.src = titleLogo;
  brandImg.alt = "On Fire Game";
  brand.append(brandImg);

  left.append(brand);

  const right = el("div", "header__right");
  const badge = el("span", "badge", "MVP");
  right.append(badge);

  header.append(left, right);
  return header;
}

function renderConnectionBanner(connectionState) {
  if (connectionState === "connected") return null;
  const banner = el("div", "connection-banner");
  banner.textContent = connectionState === "reconnecting" ? "再接続中..." : "接続待機中...";
  return banner;
}

function renderHome(vm, handlers) {
  const panel = el("section", "panel panel--narrow");
  panel.append(el("div", "panel__head", "荒れるコメント作成ゲーム"));

  const body = el("div", "panel__body");
  body.append(el("p", "help", "実在個人攻撃・差別・脅迫・個人情報は失格です。"));

  const createField = el("div", "field");
  createField.append(el("label", "label", "表示名"));
  const createNameInput = document.createElement("input");
  createNameInput.className = "input";
  createNameInput.value = vm.ui.homeName;
  createNameInput.placeholder = "プレイヤー名";
  createNameInput.addEventListener("input", (event) => handlers.onChangeUi("homeName", event.target.value));
  createField.append(createNameInput);

  const createBtn = el("button", "btn btn--primary btn--block", "ルーム作成");
  createBtn.addEventListener("click", handlers.onCreateRoom);

  const joinWrap = el("div", "home-join");
  joinWrap.append(el("div", "lobby__divider", "または"));

  const codeInput = document.createElement("input");
  codeInput.className = "input";
  codeInput.value = vm.ui.joinCode;
  codeInput.placeholder = "ルームコード (例: A1B2C3)";
  codeInput.addEventListener("input", (event) => handlers.onChangeUi("joinCode", event.target.value));

  const joinNameInput = document.createElement("input");
  joinNameInput.className = "input";
  joinNameInput.value = vm.ui.joinName;
  joinNameInput.placeholder = "表示名";
  joinNameInput.addEventListener("input", (event) => handlers.onChangeUi("joinName", event.target.value));

  const joinBtn = el("button", "btn btn--secondary btn--block", "ルーム参加");
  joinBtn.addEventListener("click", handlers.onJoinRoom);

  joinWrap.append(codeInput, joinNameInput, joinBtn);
  body.append(createField, createBtn, joinWrap);
  panel.append(body);
  return panel;
}

function routeHint(vm) {
  return vm.route.phase ? `/room/${vm.route.code}/${vm.route.phase}` : "/";
}

function renderPlayers(players, hostId) {
  const wrap = el("div", "players-list");
  players.forEach((player) => {
    const row = el("div", "player-row");
    const left = el("div", "player-row__left", player.name);
    if (player.id === hostId) {
      left.append(" (Host)");
    }
    const right = el("div", `player-state ${player.connected ? "is-online" : "is-offline"}`);
    right.textContent = player.connected ? "online" : "offline";
    row.append(left, right);
    wrap.append(row);
  });
  return wrap;
}

function renderLobby(vm, handlers) {
  const room = vm.room;
  const isHost = vm.you?.isHost;

  const shell = el("div", "shell shell--game");

  const leftPanel = el("aside", "panel");
  leftPanel.append(el("div", "panel__head", "参加者"));
  const leftBody = el("div", "panel__body");
  leftBody.append(renderPlayers(room.players, room.hostId));
  leftPanel.append(leftBody);

  const center = el("main", "panel");
  center.append(el("div", "panel__head", `ルーム ${room.code} / Lobby`));
  const centerBody = el("div", "panel__body");

  const settings = el("div", "settings-grid");
  const roundInput = document.createElement("input");
  roundInput.type = "number";
  roundInput.className = "input";
  roundInput.min = "1";
  roundInput.max = "10";
  roundInput.value = String(vm.ui.roundCountDraft ?? room.settings.roundCount);
  roundInput.disabled = !isHost;
  roundInput.addEventListener("input", (event) => handlers.onChangeUi("roundCountDraft", event.target.value));

  const timeInput = document.createElement("input");
  timeInput.type = "number";
  timeInput.className = "input";
  timeInput.min = "15";
  timeInput.max = "180";
  timeInput.value = String(vm.ui.timeLimitDraft ?? room.settings.timeLimitSec);
  timeInput.disabled = !isHost;
  timeInput.addEventListener("input", (event) => handlers.onChangeUi("timeLimitDraft", event.target.value));

  const topicInput = document.createElement("input");
  topicInput.className = "input";
  topicInput.placeholder = "お題を手入力で上書き (任意)";
  topicInput.value = vm.ui.topicOverride || "";
  topicInput.disabled = !isHost;
  topicInput.addEventListener("input", (event) => handlers.onChangeUi("topicOverride", event.target.value));

  const anonymousCheck = document.createElement("input");
  anonymousCheck.type = "checkbox";
  anonymousCheck.checked = vm.ui.anonymousDraft ?? room.settings.anonymous;
  anonymousCheck.disabled = !isHost;
  anonymousCheck.addEventListener("change", (event) => handlers.onChangeUi("anonymousDraft", event.target.checked));

  const anonymousLabel = el("label", "check-label", "公開時に匿名表示");
  anonymousLabel.prepend(anonymousCheck);

  settings.append(el("label", "label", "ラウンド数"), roundInput);
  settings.append(el("label", "label", "制限時間(秒)"), timeInput);
  settings.append(el("label", "label", "お題上書き"), topicInput);

  const actionRow = el("div", "actions-row");
  if (isHost) {
    const applyBtn = el("button", "btn btn--secondary", "設定保存");
    applyBtn.addEventListener("click", handlers.onUpdateSettings);
    const startBtn = el("button", "btn btn--primary", "ゲーム開始");
    startBtn.addEventListener("click", handlers.onStartRound);
    actionRow.append(applyBtn, startBtn);
  }

  centerBody.append(settings, anonymousLabel, actionRow);
  center.append(centerBody);

  const rightPanel = el("aside", "panel");
  rightPanel.append(el("div", "panel__head", "ガイド"));
  const rightBody = el("div", "panel__body");
  rightBody.append(el("p", "help", "2〜8人推奨。投稿は時間内に何度でも上書きできます。"));
  rightBody.append(el("p", "help", "採点は4軸で各1位を選択。自分には投票できません。"));
  rightPanel.append(rightBody);

  shell.append(leftPanel, center, rightPanel);
  return shell;
}

function renderRound(vm, handlers) {
  const room = vm.room;
  const round = room.activeRound;
  const meSubmission = round?.submissions?.find((submission) => submission.playerId === vm.you.id);
  const submittedCount = round?.submittedCount || 0;

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / WRITING`));

  const body = el("div", "panel__body");
  body.append(el("div", "topic-box", round.topicText));
  body.append(el("p", "help", `提出済み: ${submittedCount}/${room.players.length}`));
  body.append(el("p", "help", `残り時間: ${vm.roundTick.remainingSec ?? "--"}秒`));

  const textarea = document.createElement("textarea");
  textarea.className = "input textarea";
  textarea.maxLength = 280;
  textarea.placeholder = "コメントを入力 (280文字以内)";
  textarea.value = vm.ui.submissionText;
  textarea.addEventListener("input", (event) => handlers.onChangeUi("submissionText", event.target.value));

  const submitBtn = el("button", "btn btn--primary", "投稿を送信/更新");
  submitBtn.addEventListener("click", handlers.onSubmitWriting);

  body.append(textarea, submitBtn);

  if (meSubmission?.submittedAt) {
    const status = el("div", `submission-status ${meSubmission.isDisqualified ? "is-dq" : ""}`);
    status.textContent = meSubmission.isDisqualified
      ? `失格判定: ${meSubmission.dqReason}`
      : "投稿済み (時間内は再編集可)";
    body.append(status);
  }

  if (vm.you.isHost) {
    const revealBtn = el("button", "btn btn--secondary", "ホストが一斉公開へ進める");
    revealBtn.addEventListener("click", handlers.onForceReveal);
    body.append(revealBtn);
  }

  panel.append(body);
  return panel;
}

function renderReveal(vm, handlers) {
  const room = vm.room;
  const round = room.activeRound;

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / REVEAL`));

  const body = el("div", "panel__body");
  const list = el("div", "submission-grid");

  round.submissions.forEach((submission, index) => {
    const card = el("article", "submission-card");
    const player = room.players.find((p) => p.id === submission.playerId);
    const displayName = room.settings.anonymous ? `Player ${index + 1}` : player?.name || "Unknown";
    card.append(el("div", "submission-card__head", displayName));

    if (submission.isDisqualified) {
      const masked = el("div", "dq-mask", "ライン越えで失格 (本文非表示)");
      const reason = el("div", "help", submission.dqReason || "規約違反");
      card.append(masked, reason);
    } else {
      card.append(el("div", "submission-card__text", submission.text || "(未提出)"));
    }

    list.append(card);
  });

  body.append(list);

  if (vm.you.isHost) {
    const nextBtn = el("button", "btn btn--primary", "採点フェーズへ");
    nextBtn.addEventListener("click", handlers.onStartScoring);
    body.append(nextBtn);
  } else {
    body.append(el("p", "help", "ホストの進行を待っています..."));
  }

  panel.append(body);
  return panel;
}

function renderScore(vm, handlers) {
  const room = vm.room;
  const round = room.activeRound;

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / SCORING`));
  const body = el("div", "panel__body");

  const votingTargets = round.submissions.filter((submission) => {
    if (submission.playerId === vm.you.id) return false;
    if (submission.isDisqualified) return false;
    return true;
  });

  body.append(el("p", "help", `投票完了: ${round.votedCount || 0}/${round.totalVoters || room.players.length}`));

  AXES.forEach((axis) => {
    const field = el("div", "field");
    field.append(el("label", "label", `${axis.label} (1位を選択)`));

    const select = document.createElement("select");
    select.className = "input";

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "選択してください";
    select.append(placeholder);

    votingTargets.forEach((submission, index) => {
      const option = document.createElement("option");
      option.value = submission.playerId;
      const player = room.players.find((p) => p.id === submission.playerId);
      option.textContent = room.settings.anonymous
        ? `Player ${index + 1}`
        : player?.name || submission.playerId;
      select.append(option);
    });

    select.value = vm.ui.votesDraft[axis.key] || "";
    select.addEventListener("change", (event) => handlers.onVoteDraft(axis.key, event.target.value));
    field.append(select);
    body.append(field);
  });

  const submitVotesBtn = el("button", "btn btn--primary", "投票を送信");
  submitVotesBtn.addEventListener("click", handlers.onSubmitVotes);
  body.append(submitVotesBtn);

  if (vm.you.isHost) {
    const forceBtn = el("button", "btn btn--secondary", "ホストが結果を確定");
    forceBtn.addEventListener("click", handlers.onFinalizeResult);
    body.append(forceBtn);
  }

  panel.append(body);
  return panel;
}

function buildRanking(vm) {
  const room = vm.room;
  const round = room.activeRound;
  const scores = round?.scoresComputed?.bySubmissionPlayerId || {};

  return room.players
    .map((player) => {
      const score = scores[player.id] || {
        axisScores: {
          NORM_CHALLENGE: 0,
          LOGIC_LEAP: 0,
          EMOTION_STIM: 0,
          ARTISTRY: 0,
        },
        total: 0,
        isDisqualified: false,
        dqReason: null,
      };
      return {
        player,
        score,
      };
    })
    .sort((a, b) => b.score.total - a.score.total);
}

function renderResult(vm, handlers) {
  const room = vm.room;
  const round = room.activeRound;
  const ranking = buildRanking(vm);

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / RESULT`));

  const body = el("div", "panel__body");
  const table = el("div", "result-table");

  ranking.forEach(({ player, score }, index) => {
    const row = el("div", `result-row ${score.isDisqualified ? "is-dq" : ""}`);
    row.append(el("div", "result-rank", String(index + 1)));
    row.append(el("div", "result-name", player.name));

    AXES.forEach((axis) => {
      row.append(el("div", "result-axis", `${axis.label}: ${score.axisScores?.[axis.key] ?? 0}`));
    });

    const totalLabel = score.isDisqualified
      ? "失格 (0点)"
      : `合計: ${score.total}`;
    row.append(el("div", "result-total", totalLabel));
    table.append(row);
  });

  body.append(table);

  if (vm.you.isHost) {
    if (room.currentRoundNo < room.settings.roundCount) {
      const nextBtn = el("button", "btn btn--primary", "次ラウンドへ");
      nextBtn.addEventListener("click", handlers.onNextRound);
      body.append(nextBtn);
    } else {
      body.append(el("p", "help", "最終ラウンドが完了しました。"));
    }
  } else {
    body.append(el("p", "help", "ホストの進行を待っています..."));
  }

  panel.append(body);
  return panel;
}

function resolvePhase(roomStatus, routePhase) {
  if (routePhase) return routePhase;
  if (!roomStatus) return "lobby";
  if (roomStatus === STATUS.LOBBY) return "lobby";
  if (roomStatus === STATUS.WRITING) return "round";
  if (roomStatus === STATUS.REVEAL) return "reveal";
  if (roomStatus === STATUS.SCORING) return "score";
  if (roomStatus === STATUS.RESULT || roomStatus === STATUS.ENDED) return "result";
  return "lobby";
}

export function renderGameApp(root, vm, handlers) {
  const app = el("div", "app");
  app.append(renderHeader(handlers.onBackHome));

  const banner = renderConnectionBanner(vm.connectionState);
  if (banner) app.append(banner);

  const container = el("div", "container");

  if (!vm.room) {
    container.append(renderHome(vm, handlers));
    app.append(container);
    app.append(mountToast());
    root.replaceChildren(app);
    return;
  }

  const phase = resolvePhase(vm.room.status, vm.route.phase);
  const routeLabel = el("div", "route-hint", `Route: ${routeHint(vm)} (${phase})`);
  container.append(routeLabel);

  if (phase === "lobby") {
    container.append(renderLobby(vm, handlers));
  } else if (phase === "round") {
    container.append(renderRound(vm, handlers));
  } else if (phase === "reveal") {
    container.append(renderReveal(vm, handlers));
  } else if (phase === "score") {
    container.append(renderScore(vm, handlers));
  } else {
    container.append(renderResult(vm, handlers));
  }

  app.append(container);
  app.append(mountToast());
  root.replaceChildren(app);
}
