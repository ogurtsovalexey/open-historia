const SCRIPT_PATTERNS = {
  ar: /\p{Script=Arabic}/gu,
  bn: /\p{Script=Bengali}/gu,
  el: /\p{Script=Greek}/gu,
  fa: /\p{Script=Arabic}/gu,
  gu: /\p{Script=Gujarati}/gu,
  he: /\p{Script=Hebrew}/gu,
  hi: /\p{Script=Devanagari}/gu,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
  km: /\p{Script=Khmer}/gu,
  kn: /\p{Script=Kannada}/gu,
  ko: /[\p{Script=Hangul}\p{Script=Han}]/gu,
  ml: /\p{Script=Malayalam}/gu,
  mr: /\p{Script=Devanagari}/gu,
  my: /\p{Script=Myanmar}/gu,
  ne: /\p{Script=Devanagari}/gu,
  pa: /\p{Script=Gurmukhi}/gu,
  ru: /\p{Script=Cyrillic}/gu,
  si: /\p{Script=Sinhala}/gu,
  ta: /\p{Script=Tamil}/gu,
  te: /\p{Script=Telugu}/gu,
  th: /\p{Script=Thai}/gu,
  uk: /\p{Script=Cyrillic}/gu,
  ur: /\p{Script=Arabic}/gu,
  zh: /\p{Script=Han}/gu,
};

export const looksLikeTargetLanguage = (text, language) => {
  const pattern = SCRIPT_PATTERNS[language];
  if (!pattern) return false;
  const letters = String(text ?? "").match(/\p{L}/gu) ?? [];
  if (letters.length < 2) return false;
  const targetLetters = String(text ?? "").match(pattern) ?? [];
  return targetLetters.length / letters.length >= 0.55;
};

export const shouldTranslateUiText = (text, language, knownTranslations = new Set()) => {
  const trimmed = String(text ?? "").trim();
  if (trimmed.length <= 1 || trimmed.length >= 3000) return false;
  if (knownTranslations.has(trimmed)) return false;
  if (looksLikeTargetLanguage(trimmed, language)) return false;
  return /[A-Za-z]{2}/.test(trimmed);
};
