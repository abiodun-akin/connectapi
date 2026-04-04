/**
 * Message Analysis Utility
 * Primary: Google Gemini API for intelligent analysis
 * Fallback: Pattern matching and heuristics
 */

const geminiAnalyzer = require("./geminiAnalyzer");

const suspiciousPatterns = {
  // Payment/fraud related
  payment: [
    /wire\s+(money|transfer|funds)/gi,
    /bank\s+account\s+(number|details)/gi,
    /credit\s+card/gi,
    /western\s+union/gi,
    /money\s+gram/gi,
    /paypal/gi,
    /cryptocurrency|bitcoin|ethereum|crypto/gi,
    /advance\s+(fee|payment|money)/gi,
  ],
  
  // Romantic scam patterns
  romance: [
    /i\s+love\s+you/gi,
    /marry|marriage/gi,
    /boyfriend|girlfriend/gi,
    /divorce|separated/gi,
    /need.*money.*for.*ticket/gi,
    /send.*money.*emergency/gi,
  ],
  
  // Phishing/account compromise
  phishing: [
    /password|PIN|account\s+number/gi,
    /verify.*account/gi,
    /confirm.*identity/gi,
    /update.*payment/gi,
    /click.*link/gi,
    /download.*file/gi,
  ],
  
  // Spam/irrelevant content
  spam: [
    /viagra|cialis|medication/gi,
    /lottery|prize|winner/gi,
    /click\s+here/gi,
    /make\s+money\s+fast/gi,
    /easy\s+money/gi,
  ],
};

const warningKeywords = {
  urgency: [/urgent|asap|immediately|quickly/gi],
  pressure: [/must|have\s+to|cannot|don't|penalty|will.*action/gi],
  secrecy: [/secret|don't\s+tell|keep.*quiet|between\s+us/gi],
};

/**
 * Pattern-based analysis (fallback)
 * Analyzes messages for suspicious patterns
 */
function analyzeMessagePatterns(content) {
  if (!content || typeof content !== "string") {
    return {
      isSuspicious: false,
      riskScore: 0,
      reason: "Invalid content",
      flaggedPatterns: [],
      timestamp: new Date(),
    };
  }

  let riskScore = 0;
  const flaggedPatterns = [];

  // Check for suspicious patterns
  for (const category in suspiciousPatterns) {
    const patterns = suspiciousPatterns[category];
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        riskScore += 15;
        flaggedPatterns.push({
          category,
          pattern: pattern.source,
        });
      }
      pattern.lastIndex = 0; // Reset regex state for global patterns
    }
  }

  // Check for warning keywords
  for (const warningType in warningKeywords) {
    const patterns = warningKeywords[warningType];
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        riskScore += 8;
      }
      pattern.lastIndex = 0; // Reset regex state for global patterns
    }
  }

  // Check content characteristics
  const urlCount = (content.match(/https?:\/\/\S+/gi) || []).length;
  if (urlCount > 2) {
    riskScore += 15;
    flaggedPatterns.push({
      category: "spam",
      pattern: `Multiple URLs (${urlCount})`,
    });
  }

  const allCaps = (content.match(/[A-Z]{5,}/g) || []).length;
  if (allCaps > 3) {
    riskScore += 5;
  }

  // Check message length extremes
  if (content.length > 2000) {
    riskScore += 5;
  }

  // Cap risk score at 100
  riskScore = Math.min(riskScore, 100);

  // Determine if suspicious (score > 30)
  const isSuspicious = riskScore > 30;

  let reason = "";
  if (riskScore === 0) {
    reason = "No suspicious patterns detected";
  } else if (flaggedPatterns.length > 0) {
    reason = `Detected suspicious patterns: ${flaggedPatterns.map((p) => p.category).join(", ")}`;
  } else if (riskScore > 0) {
    reason = "Multiple warning keywords detected";
  }

  return {
    isSuspicious,
    riskScore,
    reason,
    flaggedPatterns,
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
    reason: analysis.reason,
    patterns: analysis.flaggedPatterns,
    color: getRiskColor(analysis.riskScore),
  };
}

/**
 * Unified analysis: Gemini (primary) + Pattern Matching (fallback)
 * IMPORTANT: This function is ASYNC - must use await
 */
async function analyzeMessage(content) {
  // Get pattern analysis as fallback
  const patternAnalysis = analyzeMessagePatterns(content);

  // Try Gemini analysis
  const geminiResult = await geminiAnalyzer.analyzeMessage(
    content,
    patternAnalysis
  );

  return geminiResult;
}

module.exports = {
  analyzeMessage, // Primary function - use this (async)
  analyzeMessagePatterns, // Pattern-only fallback
  getRiskLevel,
  getRiskColor,
  formatAnalysisResult,
  getGeminiStatus: geminiAnalyzer.getStatus,
};
