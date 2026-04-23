/**
 * Enhanced Message Analyzer v2
 * Improvements:
 * - Context-aware pattern detection
 * - Weighted pattern scoring (not all patterns equal)
 * - Confidence scoring based on corroborating patterns
 * - False positive reduction with context whitelisting
 * - Category-specific detection rules
 */

const geminiAnalyzer = require("./geminiAnalyzer");

/**
 * Pattern definitions with weights and context requirements
 * Higher weight = more suspicious
 */
const patternDefinitions = {
  // Payment/fraud related (HIGH RISK if combined)
  payment: [
    {
      pattern: /wire\s+(money|transfer|funds)/gi,
      weight: 20, // Very specific, high confidence
      category: "payment",
      contextRequired: ["bank", "account"],
      contextBoost: 10,
    },
    {
      pattern: /bank\s+account\s+(number|details)/gi,
      weight: 25, // Asking for account info is very suspicious
      category: "payment",
      contextRequired: ["send", "transfer", "wire"],
    },
    {
      pattern: /credit\s+card/gi,
      weight: 15,
      category: "payment",
    },
    {
      pattern:
        /western\s+union|money\s+gram|paypal|cryptocurrency|bitcoin|ethereum|crypto/gi,
      weight: 18,
      category: "payment",
    },
    {
      pattern: /advance\s+(fee|payment|money)/gi,
      weight: 22, // Advance fee scams are classic fraud
      category: "payment",
    },
  ],

  // Romantic scam patterns (require combination for high score)
  romance: [
    {
      pattern: /i\s+love\s+you/gi,
      weight: 5, // Low alone, high in context
      category: "romance",
      contextRequired: ["money", "send", "visit", "ticket"],
      contextBoost: 20,
    },
    {
      pattern: /marry|marriage|married/gi,
      weight: 3, // Very context-dependent
      category: "romance",
      contextRequired: ["love", "forever", "money"],
      contextBoost: 15,
      // Whitelist terms that commonly use "marry" in farm context
      whitelistPatterns: [/combine|pair|match|companion|breed|cross/gi],
    },
    {
      pattern: /boyfriend|girlfriend|husband|wife/gi,
      weight: 8,
      category: "romance",
      contextRequired: ["love", "meet", "money", "visit"],
      contextBoost: 15,
    },
    {
      pattern: /divorce|separated|lonely|heartbreak/gi,
      weight: 7,
      category: "romance",
      contextRequired: ["money", "send", "help"],
      contextBoost: 18,
    },
    {
      pattern: /need.*money.*for.*ticket|send.*money.*emergency/gi,
      weight: 25, // Very specific romantic scam
      category: "romance",
    },
  ],

  // Phishing/account compromise
  phishing: [
    {
      pattern: /verify.*password|confirm.*password/gi,
      weight: 30, // Asking for passwords is VERY suspicious
      category: "phishing",
    },
    {
      pattern: /verify.*account|confirm.*identity/gi,
      weight: 22,
      category: "phishing",
      contextRequired: ["click", "link", "urgent"],
    },
    {
      pattern: /click.*link|download.*file/gi,
      weight: 12,
      category: "phishing",
    },
    {
      pattern: /update.*payment|confirm.*payment/gi,
      weight: 18,
      category: "phishing",
    },
    {
      pattern: /account\s+number|PIN|security\s+code/gi,
      weight: 28,
      category: "phishing",
    },
  ],

  // Spam/irrelevant content
  spam: [
    {
      pattern: /viagra|cialis|medication/gi,
      weight: 20,
      category: "spam",
    },
    {
      pattern: /lottery|prize|winner|congratulations.*won/gi,
      weight: 25, // Classic spam/scam
      category: "spam",
    },
    {
      pattern: /click\s+here|http/gi,
      weight: 5, // Low alone, context matters
      category: "spam",
    },
    {
      pattern: /make\s+money\s+fast|easy\s+money/gi,
      weight: 18,
      category: "spam",
    },
  ],
};

/**
 * Warning keywords with weight (add to score when combined with patterns)
 */
const warningKeywords = {
  urgency: {
    patterns: [/urgent|asap|immediately|quickly|right\s+now/gi],
    weight: 5,
  },
  pressure: {
    patterns: [
      /must|have\s+to|cannot|don't|penalty|will\s+take\s+action|or\s+else/gi,
    ],
    weight: 6,
  },
  secrecy: {
    patterns: [/secret|don't\s+tell|keep.*quiet|between\s+us|confidential/gi],
    weight: 8, // Secrecy is a red flag multiplier
  },
};

/**
 * Farm/agriculture context keywords (reduces risk score)
 */
const farmContextKeywords = [
  /farm|crop|soil|harvest|seed|fertilizer|pesticide|irrigation/gi,
  /livestock|cattle|poultry|goat|sheep|pig/gi,
  /agriculture|agricultural|agri-business/gi,
  /produce|vegetable|fruit|grain|wheat|corn|rice/gi,
  /farming|farmer|farmland|plantation/gi,
  /market|buyer|seller|supplier|vendor/gi,
];

/**
 * Enhanced pattern analysis with context awareness
 */
function analyzeMessagePatternsEnhanced(content) {
  if (!content || typeof content !== "string") {
    return {
      isSuspicious: false,
      riskScore: 0,
      confidence: 1.0,
      reason: "Invalid content",
      flaggedPatterns: [],
      contextualNotes: [],
      timestamp: new Date(),
    };
  }

  let riskScore = 0;
  const flaggedPatterns = [];
  const contextualNotes = [];
  const matchedKeywords = {};

  // Check for farm context (reduces false positives)
  const contentLower = content.toLowerCase();
  let farmContextCount = 0;
  for (const keyword of farmContextKeywords) {
    const matches = content.match(keyword);
    if (matches) {
      farmContextCount += matches.length;
    }
    keyword.lastIndex = 0;
  }

  const hasFarmContext = farmContextCount >= 2;
  if (hasFarmContext) {
    contextualNotes.push(
      "Farm/agriculture context detected - context-aware analysis applied",
    );
  }

  // Analyze each category
  for (const category in patternDefinitions) {
    const patterns = patternDefinitions[category];

    for (const patternDef of patterns) {
      if (patternDef.pattern.test(content)) {
        // Check for whitelist patterns (e.g., "marry" in farm context)
        if (patternDef.whitelistPatterns) {
          let whitelisted = false;
          for (const whitelistPattern of patternDef.whitelistPatterns) {
            if (whitelistPattern.test(content)) {
              whitelisted = true;
              contextualNotes.push(
                `"${patternDef.pattern.source}" appears in farm/neutral context`,
              );
              break;
            }
            whitelistPattern.lastIndex = 0;
          }

          if (whitelisted && category === "romance" && hasFarmContext) {
            // Skip this pattern - likely false positive
            patternDef.pattern.lastIndex = 0;
            continue;
          }
        }

        // Check for required context
        let contextScore = patternDef.weight;
        if (
          patternDef.contextRequired &&
          patternDef.contextRequired.length > 0
        ) {
          const contextMatches = patternDef.contextRequired.filter((ctx) =>
            content.toLowerCase().includes(ctx),
          ).length;

          // Reduce score if context is missing
          if (contextMatches === 0) {
            contextScore *= 0.3; // Only 30% weight without context
            contextualNotes.push(
              `"${category}" pattern found but missing money/urgency context`,
            );
          } else if (contextMatches < patternDef.contextRequired.length) {
            contextScore *= 0.6; // Partial context
            contextualNotes.push(
              `"${category}" pattern found with partial context (${contextMatches}/${patternDef.contextRequired.length})`,
            );
          } else {
            contextScore += patternDef.contextBoost || 0; // Full context bonus
          }
        }

        // Farm context penalty (reduce score)
        if (hasFarmContext && category === "romance") {
          contextScore *= 0.5;
        }

        riskScore += contextScore;
        flaggedPatterns.push({
          category,
          pattern: patternDef.pattern.source.substring(0, 50),
          weight: patternDef.weight,
        });
      }
      patternDef.pattern.lastIndex = 0;
    }
  }

  // Analyze warning keywords
  const detectedKeywords = [];
  for (const keywordType in warningKeywords) {
    const keywordSet = warningKeywords[keywordType];
    for (const pattern of keywordSet.patterns) {
      if (pattern.test(content)) {
        detectedKeywords.push(keywordType);
        riskScore += keywordSet.weight;
      }
      pattern.lastIndex = 0;
    }
  }

  // URL analysis (updated)
  const urlCount = (content.match(/https?:\/\/\S+/gi) || []).length;
  if (urlCount > 2) {
    riskScore += 15;
    flaggedPatterns.push({
      category: "spam",
      pattern: `Multiple URLs (${urlCount})`,
      weight: 15,
    });
  } else if (urlCount > 0 && detectedKeywords.includes("urgency")) {
    // URL + urgency is suspicious
    riskScore += 8;
  }

  // Check for ALL CAPS (spam indicator)
  const allCaps = (content.match(/[A-Z]{5,}/g) || []).length;
  if (allCaps > 3) {
    riskScore += 5;
  }

  // Longer messages are more likely to contain scam content
  if (content.length > 500 && flaggedPatterns.length > 0) {
    riskScore += 3;
  }

  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100);

  // Calculate confidence based on pattern consistency
  let confidence = 0.5;
  if (flaggedPatterns.length === 0) {
    confidence = 1.0; // High confidence it's safe
  } else if (flaggedPatterns.length === 1) {
    confidence = 0.4; // Low confidence with single pattern
  } else if (flaggedPatterns.length >= 3) {
    confidence = 0.9; // High confidence with multiple patterns
  } else {
    confidence = 0.65; // Medium confidence with 2 patterns
  }

  // Boost confidence if patterns are in same category
  const uniqueCategories = new Set(flaggedPatterns.map((p) => p.category)).size;
  if (uniqueCategories === 1 && flaggedPatterns.length >= 2) {
    confidence = Math.min(0.95, confidence + 0.15);
  }

  // Reduce confidence for farm context false positives
  if (hasFarmContext && uniqueCategories <= 1) {
    confidence *= 0.7;
  }

  // Determine if suspicious (score > 30, consider confidence)
  let isSuspicious = riskScore > 30;

  // Low confidence can override marginal scores (20-30 range)
  // But don't override high-weight patterns like passwords, wire transfers, bank requests
  const highRiskPatternFound = flaggedPatterns.some(
    (p) =>
      (p.weight >= 20 && ["payment", "phishing"].includes(p.category)) ||
      p.pattern.includes("password") ||
      /bank\s+account/i.test(p.pattern),
  );

  if (confidence < 0.5 && riskScore < 50 && !highRiskPatternFound) {
    isSuspicious = false; // Low confidence overrides marginal scores
  }

  let reason = "";
  if (riskScore === 0) {
    reason = "No suspicious patterns detected";
  } else if (flaggedPatterns.length > 0) {
    const topCategories = [...new Set(flaggedPatterns.map((p) => p.category))]
      .slice(0, 2)
      .join(", ");
    reason = `Detected ${topCategories} pattern(s) - Confidence: ${(confidence * 100).toFixed(0)}%`;
  } else if (detectedKeywords.length > 0) {
    reason = `Warning keywords detected: ${detectedKeywords.join(", ")}`;
  }

  return {
    isSuspicious,
    riskScore,
    confidence: Math.round(confidence * 100) / 100,
    reason,
    flaggedPatterns,
    detectedKeywords,
    contextualNotes,
    hasFarmContext,
    timestamp: new Date(),
  };
}

/**
 * Get risk level string for UI/dashboard
 */
function getRiskLevel(riskScore) {
  if (riskScore === 0) return "SAFE";
  if (riskScore <= 20) return "LOW";
  if (riskScore <= 50) return "MEDIUM";
  if (riskScore <= 80) return "HIGH";
  return "CRITICAL";
}

/**
 * Get risk color for UI
 */
function getRiskColor(riskScore) {
  if (riskScore === 0) return "#28a745"; // green
  if (riskScore <= 20) return "#ffc107"; // yellow
  if (riskScore <= 50) return "#fd7e14"; // orange
  if (riskScore <= 80) return "#dc3545"; // red
  return "#721c24"; // dark red
}

/**
 * Format analysis result for human reading
 */
function formatAnalysisResult(analysis) {
  return {
    level: getRiskLevel(analysis.riskScore),
    score: analysis.riskScore,
    confidence: analysis.confidence,
    reason: analysis.reason,
    patterns: analysis.flaggedPatterns,
    keywords: analysis.detectedKeywords,
    contextNotes: analysis.contextualNotes,
    color: getRiskColor(analysis.riskScore),
  };
}

module.exports = {
  analyzeMessagePatternsEnhanced,
  getRiskLevel,
  getRiskColor,
  formatAnalysisResult,
  // For testing
  patternDefinitions,
  warningKeywords,
  farmContextKeywords,
};
