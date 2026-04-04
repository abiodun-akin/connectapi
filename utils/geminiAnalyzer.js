/**
 * Google Gemini API Integration for Message Analysis
 * Provides advanced NLP-based suspicious content detection
 * Falls back to pattern matching if API unavailable
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Simple in-memory cache for analysis results (TTL: 1 hour)
const analysisCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Initialize Gemini client
let geminiClient = null;

function initializeGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn(
      "[Gemini] API key not configured. Will use fallback pattern matching."
    );
    return null;
  }

  try {
    return new GoogleGenerativeAI(apiKey);
  } catch (error) {
    console.error("[Gemini] Failed to initialize:", error.message);
    return null;
  }
}

/**
 * Generate cache key from message content
 */
function getCacheKey(content) {
  // Use first 100 chars + length as simple hash
  return `${content.substring(0, 100)}_${content.length}`;
}

/**
 * Check if cached analysis is still valid
 */
function getCachedAnalysis(content) {
  const key = getCacheKey(content);
  const cached = analysisCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.analysis;
  }

  if (cached) {
    analysisCache.delete(key); // Remove expired entry
  }

  return null;
}

/**
 * Store analysis in cache
 */
function cacheAnalysis(content, analysis) {
  const key = getCacheKey(content);
  analysisCache.set(key, {
    analysis,
    timestamp: Date.now(),
  });
}

/**
 * Analyze message using Google Gemini
 * Returns: { isSuspicious, riskScore, reason, confidence, method }
 */
async function analyzeWithGemini(content) {
  if (!geminiClient) {
    return null;
  }

  try {
    const model = geminiClient.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `You are a fraud detection expert specialized in identifying scam and suspicious messages.

Analyze the following message for suspicious content. Look for:
- Payment/money transfer requests (wire, bank details, crypto, PayPal)
- Romance scams or advance fee fraud
- Phishing attempts (password requests, account verification)
- Spam or irrelevant content
- Urgency or pressure tactics
- Requests for secrecy

Message to analyze:
"${content}"

Respond with ONLY a JSON object (no markdown, no code blocks):
{
  "isSuspicious": boolean,
  "riskScore": number (0-100),
  "reason": string (brief explanation),
  "confidence": number (0-1, how confident you are),
  "detectedPatterns": array of strings
}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON response (handle potential markdown formatting)
    let jsonText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const analysis = JSON.parse(jsonText);

    // Validate response structure
    if (
      typeof analysis.isSuspicious !== "boolean" ||
      typeof analysis.riskScore !== "number" ||
      !analysis.reason ||
      typeof analysis.confidence !== "number"
    ) {
      throw new Error("Invalid response structure");
    }

    return {
      ...analysis,
      method: "gemini",
      timestamp: new Date(),
    };
  } catch (error) {
    console.error(
      "[Gemini] Analysis failed:",
      error.message.substring(0, 100)
    );
    return null; // Will trigger fallback to pattern matching
  }
}

/**
 * Combined analysis: Gemini + Pattern Matching
 * Uses Gemini as primary, falls back to patterns if unavailable
 */
async function analyzeMessage(content, patternAnalysis) {
  if (!content || typeof content !== "string") {
    return {
      isSuspicious: false,
      riskScore: 0,
      reason: "Invalid content",
      confidence: 1,
      method: "none",
    };
  }

  // Check cache first
  const cached = getCachedAnalysis(content);
  if (cached) {
    return { ...cached, fromCache: true };
  }

  // Try Gemini analysis
  if (geminiClient) {
    const geminiResult = await analyzeWithGemini(content);
    if (geminiResult) {
      cacheAnalysis(content, geminiResult);
      return geminiResult;
    }
  }

  // Fallback to pattern matching
  if (patternAnalysis) {
    const fallback = {
      isSuspicious: patternAnalysis.isSuspicious,
      riskScore: patternAnalysis.riskScore,
      reason: patternAnalysis.reason,
      detectedPatterns: patternAnalysis.flaggedPatterns,
      confidence: patternAnalysis.riskScore > 50 ? 0.9 : 0.7,
      method: "pattern_matching",
      timestamp: new Date(),
    };
    cacheAnalysis(content, fallback);
    return fallback;
  }

  return {
    isSuspicious: false,
    riskScore: 0,
    reason: "No analyzer available",
    confidence: 0,
    method: "fallback",
  };
}

/**
 * Get Gemini client status
 */
function getStatus() {
  return {
    initialized: geminiClient !== null,
    cacheSize: analysisCache.size,
    apiKeyConfigured: !!process.env.GEMINI_API_KEY,
  };
}

/**
 * Clear cache if needed
 */
function clearCache() {
  analysisCache.clear();
}

// Initialize on module load
geminiClient = initializeGemini();

module.exports = {
  analyzeMessage,
  analyzeWithGemini,
  getStatus,
  clearCache,
  getCachedAnalysis,
};
