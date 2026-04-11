/**
 * Message Analyzer - Language Normalization Module
 * Path D: Advanced Functionality
 *
 * Normalizes text variations to improve pattern matching:
 * - Leetspeak (p@ssw0rd → password)
 * - Misspellings and typos
 * - Unicode tricks (ρâsswörd → password)
 * - Extra spacing and punctuation
 * - Mixed cases and numbers
 */

/**
 * Normalize message content for improved pattern matching
 * @param {String} content - Raw message content
 * @returns {Object} { normalized, originalLength, normalizationRatio, variations }
 */
function normalizeMessageContent(content) {
  if (!content || typeof content !== "string") {
    return {
      normalized: "",
      originalLength: 0,
      normalizationRatio: 0,
      variations: [],
    };
  }

  const originalLength = content.length;
  let normalized = content;
  const variations = [];

  // Step 1: Handle leetspeak substitutions
  normalized = denormalizeLeetspeak(normalized);
  if (normalized !== content) {
    variations.push("leetspeak_detected");
  }

  // Step 2: Handle common misspellings and typos
  const misspellingResult = correctCommonMisspellings(normalized);
  if (misspellingResult.corrected) {
    variations.push("misspellings_corrected");
    normalized = misspellingResult.text;
  }

  // Step 3: Handle Unicode tricks (homoglyphs, lookalikes)
  const unicodeResult = normalizeUnicodeVariations(normalized);
  if (unicodeResult.corrected) {
    variations.push("unicode_normalized");
    normalized = unicodeResult.text;
  }

  // Step 4: Normalize whitespace and punctuation
  normalized = normalized
    .trim()
    .replace(/\s+/g, " ") // Multiple spaces to single
    .replace(/([!?.,;:-])\1+/g, "$1"); // Repeated punctuation to single

  variations.push("whitespace_normalized");

  // Step 5: Convert to lowercase for pattern matching (keep original for display)
  const normalizedLower = normalized.toLowerCase();

  const normalizationRatio =
    (originalLength - normalized.length) / originalLength || 0;

  return {
    normalized: normalizedLower,
    normalizedOriginal: normalized, // Preserves case/format
    originalLength,
    finalLength: normalizedLower.length,
    normalizationRatio: Math.abs(normalizationRatio).toFixed(2),
    variations,
  };
}

/**
 * Convert leetspeak to normal text
 * Examples: p@ssw0rd → password, 1nv1t3 → invite
 */
function denormalizeLeetspeak(text) {
  const leetMap = {
    "@": "a",
    4: "a",
    3: "e",
    "€": "e",
    1: "i",
    "!": "i",
    0: "o",
    9: "g",
    5: "s",
    $: "s",
    7: "t",
    "+": "t",
    2: "z",
  };

  let result = text;

  // Replace common leetspeak characters
  Object.entries(leetMap).forEach(([leet, normal]) => {
    const regex = new RegExp(leet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    result = result.replace(regex, normal);
  });

  // Handle specific leetspeak words
  const leetspeakWords = {
    "p@ssw": "passw",
    pwd: "password",
    pswd: "password",
    p4ssw: "passw",
    p455w: "passw",
    "tr@nsf3r": "transfer",
    m0ney: "money",
    u53r: "user",
    "4cc0unt": "account",
    v3r1fy: "verify",
    c0nf1rm: "confirm",
    w1r3: "wire",
    b4nk: "bank",
  };

  Object.entries(leetspeakWords).forEach(([leet, normal]) => {
    const regex = new RegExp(
      `\\b${leet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "gi",
    );
    result = result.replace(regex, normal);
  });

  return result;
}

/**
 * Correct common misspellings and edge cases
 */
function correctCommonMisspellings(text) {
  const misspellings = {
    pasword: "password",
    passowrd: "password",
    pssword: "password",
    passwrd: "password",
    passwd: "password",
    tranfer: "transfer",
    transfor: "transfer",
    transfere: "transfer",
    transmit: "transfer",
    deposite: "deposit",
    wirre: "wire",
    wier: "wire",
    acount: "account",
    accout: "account",
    verfy: "verify",
    verifice: "verify",
    confim: "confirm",
    confirme: "confirm",
    urgnt: "urgent",
    emergancy: "emergency",
    authentcate: "authenticate",
    verificaton: "verification",
  };

  let corrected = false;
  let result = text;

  Object.entries(misspellings).forEach(([wrong, right]) => {
    const regex = new RegExp(`\\b${wrong}\\b`, "gi");
    if (regex.test(result)) {
      corrected = true;
      result = result.replace(regex, right);
    }
  });

  return { text: result, corrected };
}

/**
 * Normalize Unicode variations (homoglyphs and lookalikes)
 * Examples: Cyrillic 'a' (а) looks like Latin 'a' (a)
 */
function normalizeUnicodeVariations(text) {
  const unicodeMap = {
    // Cyrillic lookalikes
    а: "a", // Cyrillic a
    с: "c", // Cyrillic s
    е: "e", // Cyrillic e
    о: "o", // Cyrillic o
    р: "p", // Cyrillic p
    х: "x", // Cyrillic x
    у: "y", // Cyrillic y
    н: "n", // Cyrillic h

    // Greek lookalikes
    α: "a", // Greek alpha
    ρ: "p", // Greek rho
    ο: "o", // Greek omicron

    // Other Unicode trick characters
    ａ: "a", // Full-width a
    ｐ: "p", // Full-width p
    ａｓｓ: "ass", // Full-width ass
    ｐａｓｓ: "pass", // Full-width pass

    // Accented characters
    á: "a",
    à: "a",
    â: "a",
    ã: "a",
    ä: "a",
    é: "e",
    è: "e",
    ê: "e",
    ë: "e",
    í: "i",
    ì: "i",
    î: "i",
    ï: "i",
    ó: "o",
    ò: "o",
    ô: "o",
    õ: "o",
    ö: "o",
    ú: "u",
    ù: "u",
    û: "u",
    ü: "u",
  };

  let corrected = false;
  let result = text;

  Object.entries(unicodeMap).forEach(([unicode, ascii]) => {
    if (result.includes(unicode)) {
      corrected = true;
      result = result.split(unicode).join(ascii);
    }
  });

  return { text: result, corrected };
}

/**
 * Extract keywords while preserving pattern meaning
 * Removes unnecessary words, keeps suspicious indicators
 */
function extractSuspiciousKeywords(content) {
  if (!content || typeof content !== "string") {
    return [];
  }

  const normalized = normalizeMessageContent(content);
  const text = normalized.normalized;

  const suspiciousKeywords = [
    "password",
    "pin",
    "code",
    "verify",
    "confirm",
    "login",
    "account",
    "bank",
    "transfer",
    "wire",
    "money",
    "urgent",
    "emergency",
    "help",
    "click",
    "link",
    "confirm",
    "authenticate",
    "update",
    "suspend",
    "limited",
  ];

  const found = suspiciousKeywords.filter((kw) => text.includes(kw));

  return {
    keywords: found,
    keywordCount: found.length,
    allKeywords: text.split(/\s+/),
  };
}

/**
 * Detect if text is obfuscated (excessive special chars, mixed scripts)
 */
function detectTextObfuscation(content) {
  if (!content || typeof content !== "string") {
    return {
      isObfuscated: false,
      obfuscationScore: 0,
      techniques: [],
    };
  }

  let obfuscationScore = 0;
  const techniques = [];

  // Check for excessive special characters
  const specialCharCount = (
    content.match(/[!@#$%^&*()\-_=+\[\]{};:'",.<>?/\\|`~]/g) || []
  ).length;
  const specialCharRatio = specialCharCount / content.length;
  if (specialCharRatio > 0.15) {
    obfuscationScore += 20;
    techniques.push("excessive_special_chars");
  }

  // Check for mixed scripts (Latin + Cyrillic + Greek)
  const hasLatin = /[a-z]/i.test(content);
  const hasCyrillic = /[а-яА-Я]/.test(content);
  const hasGreek = /[α-ωΑ-Ω]/.test(content);
  const hasUnicode = /[^\x00-\x7F]/.test(content);

  if (hasUnicode) {
    obfuscationScore += 10;
    techniques.push("unicode_characters");
  }

  const mixedScripts = [hasLatin, hasCyrillic, hasGreek].filter(
    (v) => v,
  ).length;
  if (mixedScripts > 1) {
    obfuscationScore += 25;
    techniques.push("mixed_scripts");
  }

  // Check for excessive numbers and symbols mixed in
  const alphanumAltRatio =
    (content.match(/[0-9@$!]/g) || []).length / content.length;
  const leetSignalCount = (content.match(/[0-9@$!€]/g) || []).length;
  if (alphanumAltRatio > 0.2) {
    obfuscationScore += 15;
    techniques.push("numeric_substitution");
  } else if (leetSignalCount >= 3) {
    obfuscationScore += 10;
    techniques.push("light_numeric_substitution");
  }

  if (hasUnicode && leetSignalCount >= 3) {
    obfuscationScore += 20;
    techniques.push("mixed_unicode_leet_obfuscation");
  }

  // Check for repeated punctuation
  if (/([!?.,])\1{2,}/.test(content)) {
    obfuscationScore += 10;
    techniques.push("repeated_punctuation");
  }

  return {
    isObfuscated: obfuscationScore >= 35,
    obfuscationScore: Math.min(obfuscationScore, 100),
    techniques,
    mixedScripts,
    specialCharRatio: specialCharRatio.toFixed(3),
  };
}

/**
 * Generate report on text normalization
 */
function generateNormalizationReport(originalContent) {
  const normalized = normalizeMessageContent(originalContent);
  const obfuscation = detectTextObfuscation(originalContent);
  const keywords = extractSuspiciousKeywords(originalContent);

  return {
    original: originalContent,
    normalized: normalized.normalized,
    statistics: {
      originalLength: normalized.originalLength,
      finalLength: normalized.finalLength,
      reductionPercent: (normalized.normalizationRatio * 100).toFixed(1),
    },
    obfuscationDetected: obfuscation.isObfuscated,
    obfuscationScore: obfuscation.obfuscationScore,
    obfuscationTechniques: obfuscation.techniques,
    normalizationSteps: normalized.variations,
    suspiciousKeywords: keywords.keywords,
    riskIndicators: {
      obfuscated: obfuscation.isObfuscated,
      highKeywordDensity:
        keywords.keywordCount / keywords.allKeywords.length > 0.1,
      keywordCount: keywords.keywordCount,
    },
  };
}

module.exports = {
  normalizeMessageContent,
  denormalizeLeetspeak,
  correctCommonMisspellings,
  normalizeUnicodeVariations,
  extractSuspiciousKeywords,
  detectTextObfuscation,
  generateNormalizationReport,
};
