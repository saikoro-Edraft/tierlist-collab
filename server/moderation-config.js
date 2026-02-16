const escapeRegex = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const offensiveWords = [
  "死ね",
  "殺す",
  "ぶっ殺",
  "きもい",
  "くず",
  "ばか",
  "アホ",
  "クソ",
  "レイプ",
  "強姦",
  "nigger",
  "faggot",
  "retard",
];

const discriminationWords = [
  "障害者は",
  "女は",
  "男は",
  "外国人は",
  "黒人は",
  "白人は",
  "死刑にしろ",
];

const threatPatterns = [
  /(?:殺|刺|燃や|襲)してやる/iu,
  /(?:家|住所)を晒す/iu,
  /(?:お前|てめえ).{0,6}(?:殺す|潰す)/iu,
];

const personalInfoPatterns = [
  /(?:\+?81[-\s]?)?0\d{1,4}[-\s]?\d{1,4}[-\s]?\d{3,4}/u,
  /\b\d{3}-\d{4}\b/u,
  /(東京都|北海道|(?:京都|大阪)府|.{2,4}県).{0,20}(?:市|区|町|村).{0,20}(?:\d{1,3}-\d{1,3}|\d{1,3}丁目)/u,
];

const offensivePattern = new RegExp(offensiveWords.map(escapeRegex).join("|"), "iu");
const discriminationPattern = new RegExp(discriminationWords.map(escapeRegex).join("|"), "iu");

export const moderationConfig = {
  reasons: {
    PERSONAL_INFO: "個人情報らしき記述",
    THREAT: "脅迫的表現",
    DISCRIMINATION: "差別的表現",
    ABUSE: "露骨な罵倒語",
  },
  offensivePattern,
  discriminationPattern,
  threatPatterns,
  personalInfoPatterns,
};

export function detectLineCrossing(text) {
  const normalized = (text || "").trim();
  if (!normalized) {
    return { isDisqualified: false, reason: null };
  }

  if (moderationConfig.personalInfoPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      isDisqualified: true,
      reason: moderationConfig.reasons.PERSONAL_INFO,
    };
  }

  if (moderationConfig.threatPatterns.some((pattern) => pattern.test(normalized))) {
    return {
      isDisqualified: true,
      reason: moderationConfig.reasons.THREAT,
    };
  }

  if (moderationConfig.discriminationPattern.test(normalized)) {
    return {
      isDisqualified: true,
      reason: moderationConfig.reasons.DISCRIMINATION,
    };
  }

  if (moderationConfig.offensivePattern.test(normalized)) {
    return {
      isDisqualified: true,
      reason: moderationConfig.reasons.ABUSE,
    };
  }

  return { isDisqualified: false, reason: null };
}
