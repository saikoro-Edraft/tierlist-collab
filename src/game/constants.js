export const AXES = [
  { key: "NORM_CHALLENGE", label: "規範への挑戦" },
  { key: "LOGIC_LEAP", label: "論理飛躍" },
  { key: "EMOTION_STIM", label: "感情の刺激" },
  { key: "ARTISTRY", label: "芸術点" },
];

export const AXIS_KEYS = AXES.map((axis) => axis.key);

export const DEFAULT_SETTINGS = {
  roundCount: 3,
  timeLimitSec: 60,
  anonymous: true,
};

export const FIXED_TOPICS = [
  "炎上しそうな新しい学校ルールを提案して",
  "全員がモヤっとするが妙に納得してしまう言い訳を書いて",
  "会議を最速で荒らす一言を、詩的に表現して",
  "謝罪文なのに火に油を注ぐ一文を作って",
  "一見善意だがコメント欄を地獄にする提案をして",
  "絶妙に論点をずらして空気を壊すコメントを書いて",
  "誰も求めていない正論パンチを放って",
  "場を凍らせるけど語彙だけは美しい一文を書いて",
];

export const STATUS = {
  LOBBY: "lobby",
  WRITING: "writing",
  REVEAL: "reveal",
  SCORING: "scoring",
  RESULT: "result",
  ENDED: "ended",
};

export const SCORE_PER_VOTE = 10;

export const PLAYER_LIMIT = {
  MIN: 2,
  MAX: 8,
};
