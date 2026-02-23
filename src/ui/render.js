import titleLogo from "../assets/title_line.png";
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
  const centerHead = el("div", "panel__head");
  const roomCodeBtn = el("button", "room-code-btn", `ルーム ${room.code}（クリックでルームコードをコピー）`);
  roomCodeBtn.type = "button";
  roomCodeBtn.title = "クリックでルームコードをコピー";
  roomCodeBtn.addEventListener("click", handlers.onCopyRoomCode);
  centerHead.append(roomCodeBtn);
  center.append(centerHead);
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

  const scoringModeSelect = document.createElement("select");
  scoringModeSelect.className = "input";
  scoringModeSelect.disabled = !isHost;
  const playerMode = document.createElement("option");
  playerMode.value = "player";
  playerMode.textContent = "プレイヤー採点";
  const aiMode = document.createElement("option");
  aiMode.value = "ai";
  aiMode.textContent = "AI採点";
  scoringModeSelect.append(playerMode, aiMode);
  scoringModeSelect.value = vm.ui.scoringModeDraft ?? room.settings.scoringMode ?? "player";
  scoringModeSelect.addEventListener("change", (event) => handlers.onChangeUi("scoringModeDraft", event.target.value));
  settings.append(el("label", "label", "採点モード"), scoringModeSelect);

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
  rightBody.append(el("p", "help", "採点モード: プレイヤー採点 / AI採点 を選択できます。"));
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
  const submittedLine = el("p", "help", `提出済み: ${submittedCount}/${room.players.length}`);
  submittedLine.dataset.role = "submitted-count";
  body.append(submittedLine);
  const timerLine = el("p", "help");
  const timerValue = el("span", "", String(vm.roundTick.remainingSec ?? "--"));
  timerValue.dataset.role = "remaining-sec";
  timerLine.append("残り時間: ", timerValue, "秒");
  body.append(timerLine);

  const textarea = document.createElement("textarea");
  textarea.className = "input textarea";
  textarea.dataset.role = "submission-input";
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
      ? "失格判定済み。公開時は本文がマスクされます。"
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
  const isAiMode = room.settings.scoringMode === "ai";

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
    const nextBtn = el("button", "btn btn--primary", isAiMode ? "AI採点して結果へ" : "採点フェーズへ");
    nextBtn.addEventListener("click", isAiMode ? handlers.onRunAiScoring : handlers.onStartScoring);
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
  if (room.settings.scoringMode === "ai") {
    const panel = el("section", "panel");
    panel.append(el("div", "panel__head", `Round ${round.roundNo} / AI SCORING`));
    const body = el("div", "panel__body");
    body.append(el("p", "help", "AI採点モードです。ホストがAI採点を実行すると結果へ進みます。"));
    panel.append(body);
    return panel;
  }

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / SCORING`));
  const body = el("div", "panel__body");

  const submissionByPlayerId = Object.fromEntries(
    round.submissions.map((submission) => [submission.playerId, submission]),
  );
  const votingTargets = room.players.filter((player) => {
    if (player.id === vm.you.id) return false;
    if (submissionByPlayerId[player.id]?.isDisqualified) return false;
    return true;
  });
  const isTwoPlayerMode = room.players.length === 2 && votingTargets.length === 1;
  const nonHostVotedCount = round.nonHostVotedCount || 0;
  const nonHostTotal = Math.max(0, room.players.length - 1);
  const hostLocked = vm.you?.isHost && nonHostVotedCount < nonHostTotal;

  body.append(el("p", "help", `投票完了: ${round.votedCount || 0}/${round.totalVoters || room.players.length}`));
  if (vm.you?.isHost) {
    body.append(el("p", "help", `メンバー投票: ${nonHostVotedCount}/${nonHostTotal}`));
  }
  if (hostLocked) {
    body.append(el("p", "help", "ホストはメンバー全員の投票完了後に投票できます。"));
  }
  if (votingTargets.length === 0) {
    body.append(el("p", "help", "投票対象がいないため、このラウンドは投票スキップになります。"));
  }

  body.append(el("h3", "result-subhead", "投稿一覧（確認しながら採点）"));
  const scoreSubmissionGrid = el("div", "submission-grid");
  round.submissions.forEach((submission) => {
    const player = room.players.find((p) => p.id === submission.playerId);
    const card = el("article", "submission-card");
    card.append(el("div", "submission-card__head", player?.name || submission.playerId));
    if (submission.isDisqualified) {
      const masked = el("div", "dq-mask", "ライン越えで失格 (本文非表示)");
      const reason = el("div", "help", submission.dqReason || "規約違反");
      card.append(masked, reason);
    } else {
      card.append(el("div", "submission-card__text", submission.text || "(未提出)"));
    }
    scoreSubmissionGrid.append(card);
  });
  body.append(scoreSubmissionGrid);

  if (votingTargets.length > 0) {
    AXES.forEach((axis) => {
      const field = el("div", "field axis-score-row");
      field.append(el("label", "label", `${axis.label}`));

      if (isTwoPlayerMode) {
        const opponent = votingTargets[0];
        const targetName = opponent.name || opponent.id;
        const targetFixed = el("div", "input input--readonly", targetName);
        field.append(targetFixed);

        const starSelect = document.createElement("select");
        starSelect.className = "input";
        const starPlaceholder = document.createElement("option");
        starPlaceholder.value = "";
        starPlaceholder.textContent = "星を選択";
        starSelect.append(starPlaceholder);
        [1, 2, 3, 4, 5].forEach((star) => {
          const option = document.createElement("option");
          option.value = String(star);
          option.textContent = `${"★".repeat(star)} (${star})`;
          starSelect.append(option);
        });
        starSelect.value = vm.ui.votesDraft[axis.key]?.stars ? String(vm.ui.votesDraft[axis.key]?.stars) : "";
        starSelect.addEventListener("change", (event) =>
          handlers.onVoteDraft(axis.key, { stars: Number(event.target.value), submissionPlayerId: opponent.id }),
        );
        field.append(starSelect);
      } else {
        const targetSelect = document.createElement("select");
        targetSelect.className = "input";

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "プレイヤーを選択";
        targetSelect.append(placeholder);

        votingTargets.forEach((player, index) => {
          const option = document.createElement("option");
          option.value = player.id;
          option.textContent = player.name || player.id;
          targetSelect.append(option);
        });

        targetSelect.value = vm.ui.votesDraft[axis.key]?.submissionPlayerId || "";
        targetSelect.addEventListener("change", (event) =>
          handlers.onVoteDraft(axis.key, { submissionPlayerId: event.target.value }),
        );
        const starSelect = document.createElement("select");
        starSelect.className = "input";
        const starPlaceholder = document.createElement("option");
        starPlaceholder.value = "";
        starPlaceholder.textContent = "星を選択";
        starSelect.append(starPlaceholder);
        [1, 2, 3, 4, 5].forEach((star) => {
          const option = document.createElement("option");
          option.value = String(star);
          option.textContent = `${"★".repeat(star)} (${star})`;
          starSelect.append(option);
        });
        starSelect.value = vm.ui.votesDraft[axis.key]?.stars ? String(vm.ui.votesDraft[axis.key]?.stars) : "";
        starSelect.addEventListener("change", (event) =>
          handlers.onVoteDraft(axis.key, { stars: Number(event.target.value) }),
        );

        field.append(targetSelect, starSelect);
      }
      body.append(field);
    });
  }

  const submitVotesBtn = el("button", "btn btn--primary", votingTargets.length === 0 ? "投票をスキップ" : "投票を送信");
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
        axisScores: Object.fromEntries(AXES.map((axis) => [axis.key, 0])),
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

function buildTotalRanking(vm) {
  const room = vm.room;
  const summary = Object.fromEntries(
    room.players.map((player) => [player.id, { total: 0 }]),
  );

  room.rounds.forEach((round) => {
    const byPlayer = round?.scoresComputed?.bySubmissionPlayerId || {};
    Object.entries(byPlayer).forEach(([playerId, score]) => {
      if (!summary[playerId]) {
        summary[playerId] = { total: 0 };
      }
      summary[playerId].total += Number(score?.total || 0);
    });
  });

  return room.players
    .map((player) => ({
      player,
      total: summary[player.id]?.total || 0,
    }))
    .sort((a, b) => b.total - a.total);
}

function renderResult(vm, handlers) {
  const room = vm.room;
  const round = room.activeRound;
  const ranking = buildRanking(vm);

  const panel = el("section", "panel");
  panel.append(el("div", "panel__head", `Round ${round.roundNo} / RESULT`));

  const body = el("div", "panel__body");
  if (round?.scoresComputed?.judgedBy === "ai") {
    body.append(el("p", "help", "このラウンドは AI 採点で評価されています。"));
    if (round?.scoresComputed?.judgedByModel) {
      body.append(el("p", "help", `AIモデル: ${round.scoresComputed.judgedByModel}`));
    }
  }

  body.append(el("h3", "result-subhead", "お題と回答"));
  body.append(el("div", "topic-box", round.topicText || "(お題なし)"));
  const answers = el("div", "submission-grid");
  round.submissions.forEach((submission) => {
    const player = room.players.find((p) => p.id === submission.playerId);
    const card = el("article", "submission-card");
    card.append(el("div", "submission-card__head", player?.name || submission.playerId));
    if (submission.isDisqualified) {
      const details = document.createElement("details");
      details.className = "submission-dq-details";
      const summary = document.createElement("summary");
      summary.textContent = "ライン越え（クリックで内容を表示）";
      const content = el("div", "submission-card__text");
      content.textContent = submission.text || "(本文なし)";
      details.append(summary, content);
      card.append(details);
    } else {
      card.append(el("div", "submission-card__text", submission.text || "(未提出)"));
    }
    answers.append(card);
  });
  body.append(answers);

  const table = el("div", "result-table");
  const isFinalRound = room.currentRoundNo >= room.settings.roundCount;

  ranking.forEach(({ player, score }, index) => {
    const row = el("div", `result-row ${score.isDisqualified ? "is-dq" : ""}`);
    row.append(el("div", "result-rank", String(index + 1)));
    row.append(el("div", "result-name", player.name));

    AXES.forEach((axis) => {
      row.append(el("div", "result-axis", `${axis.label}: ${score.axisScores?.[axis.key] ?? 0}`));
    });

    const totalLabel = score.isDisqualified ? "失格 (0★)" : `合計: ${score.total}★`;
    row.append(el("div", "result-total", totalLabel));
    table.append(row);
    if (score.aiComment) {
      const comment = el("div", "help", `AIの講評: ${score.aiComment}`);
      comment.style.margin = "0 0 8px 42px";
      table.append(comment);
    }
  });

  body.append(table);

  if (isFinalRound) {
    const totalHead = el("h3", "result-subhead", "総合結果（全ラウンド合計★）");
    const totalTable = el("div", "result-table");
    const totalRanking = buildTotalRanking(vm);
    totalRanking.forEach((item, index) => {
      const row = el("div", "result-row result-row--summary");
      row.append(el("div", "result-rank", String(index + 1)));
      row.append(el("div", "result-name", item.player.name));
      row.append(el("div", "result-total", `${item.total}★`));
      totalTable.append(row);
    });
    body.append(totalHead, totalTable);
  }

  if (vm.you.isHost) {
    if (!isFinalRound) {
      const nextBtn = el("button", "btn btn--primary", "次ラウンドへ");
      nextBtn.addEventListener("click", handlers.onNextRound);
      body.append(nextBtn);
    } else {
      body.append(el("p", "help", "最終ラウンドが完了しました。"));
      const backBtn = el("button", "btn btn--secondary", "ルームロビーへ戻る");
      backBtn.addEventListener("click", handlers.onBackToLobby);
      body.append(backBtn);
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
