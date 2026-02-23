export const AXES = [
  { key: "ARTISTRY", label: "芸術性" },
  { key: "LINE_CROSSING", label: "ライン越え度" },
];

export const AXIS_KEYS = AXES.map((axis) => axis.key);

export const DEFAULT_SETTINGS = {
  roundCount: 3,
  timeLimitSec: 60,
  anonymous: true,
  scoringMode: "player",
};

export const FIXED_TOPICS = [
  "残業は努力の証。若手はまず量をこなすべき",
  "既読スルーは失礼。24時間以内に全員返信すべき",
  "会議は長いほど本気度が伝わる",
  "匿名の意見は無価値。実名だけ信用する",
  "節約したいなら交際費を全部ゼロにすればいい",
  "失敗する人は準備不足。環境のせいにするな",
  "休む人ほど体調管理が甘いだけ",
  "趣味は収益化できないなら時間の無駄",
  "AIに任せれば人の創造性はもう不要",
  "正論なら言い方は気にしなくていい",
  "きょうはいい天気だなあ",
  "このツイート面白スギィ！",
  "コンビニの新作スイーツ、今日は当たりだった",
  "月曜日の朝、コーヒーが命綱",
  "電車で席を譲ってもらって少し救われた",
  "猫の動画を見てたら一日が終わった",
  "通知ゼロの日、逆に落ち着く説",
  "冷蔵庫を開けた瞬間に何を取りに来たか忘れる",
  "今さらだけどこのミーム、語感が強すぎる",
  "寝る前に5分だけのはずが延々スクロールしてる",
];

export const STATUS = {
  LOBBY: "lobby",
  WRITING: "writing",
  REVEAL: "reveal",
  SCORING: "scoring",
  RESULT: "result",
  ENDED: "ended",
};

export const STAR = {
  MIN: 1,
  MAX: 5,
};

export const PLAYER_LIMIT = {
  MIN: 2,
  MAX: 8,
};
