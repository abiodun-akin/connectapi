/**
 * Message Analyzer - Conversation Context Module
 * Path D: Advanced Functionality
 *
 * Analyzes message chains to detect scam escalation patterns.
 * Examples: {"Hi friend" → "help me" → "send money"} = escalating scam
 */
const {
  normalizeMessageContent,
} = require("./messageAnalyzerLanguageNormalization");

/**
 * Analyze a conversation chain for scam escalation patterns
 * @param {Array} messageChain - Array of message objects with sender, recipient, content, timestamp
 * @param {String} conversationContext - "romance" | "business" | "support" | "unknown"
 * @returns {Object} Analysis with risk score, escalation detected, pattern sequence
 */
async function analyzeConversationContext(
  messageChain,
  conversationContext = "unknown",
) {
  if (
    !messageChain ||
    !Array.isArray(messageChain) ||
    messageChain.length < 2
  ) {
    return {
      minimalChain: true,
      escalationDetected: false,
      riskScore: 0,
      confidence: 0,
      patterns: [],
    };
  }

  const hasInvalidTimestamp = messageChain.some((message) => {
    if (!message?.timestamp) return true;
    const ts = new Date(message.timestamp);
    return Number.isNaN(ts.getTime());
  });

  if (hasInvalidTimestamp) {
    return {
      minimalChain: true,
      escalationDetected: false,
      riskScore: 0,
      confidence: 0,
      patterns: [],
      contextType: conversationContext,
    };
  }

  // Sort messages by timestamp to ensure chronological order
  const sortedChain = [...messageChain].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  const analysis = {
    chainLength: sortedChain.length,
    timespan: calculateTimespan(sortedChain),
    escalationDetected: false,
    escalationPhases: [],
    riskScore: 0,
    confidence: 0,
    patterns: [],
    contextType: conversationContext,
  };

  // Detect escalation patterns
  for (let i = 1; i < sortedChain.length; i++) {
    const prev = sortedChain[i - 1];
    const current = sortedChain[i];

    const transition = analyzeMessageTransition(prev, current);
    analysis.patterns.push(transition);

    if (transition.isEscalation) {
      analysis.escalationDetected = true;
      analysis.escalationPhases.push({
        from: transition.fromPhase,
        to: transition.toPhase,
        messageIndex: i,
        escalationType: transition.type,
        urgencyLevel: transition.urgency,
      });
    }
  }

  // Calculate overall risk score based on escalation patterns
  if (analysis.escalationDetected) {
    analysis.riskScore = calculateEscalationRisk(analysis.escalationPhases);
    analysis.confidence = calculateConfidence(analysis.patterns);
  }

  return analysis;
}

/**
 * Detect scam phases in message content
 * Phase 1: Trust building / Relationship establishment
 * Phase 2: Problem introduction / Sympathy request
 * Phase 3: Request for specific action (money, login, etc.)
 */
function detectMessagePhase(content) {
  if (!content || typeof content !== "string") {
    return { phase: "unknown", keywords: [], score: 0 };
  }

  const normalizedContent = normalizeMessageContent(content);
  const lowerContent = normalizedContent.normalized || content.toLowerCase();

  // Phase 1: Trust Building / Greeting
  const trustBuildingKeywords = [
    "hi",
    "hello",
    "dear",
    "friend",
    "love",
    "marry",
    "beautiful",
    "nice to meet",
    "i like you",
    "you seem",
    "special",
    "connect",
    "dating",
  ];

  // Phase 2: Problem / Sympathy
  const sympathyKeywords = [
    "help",
    "problem",
    "trouble",
    "urgent",
    "emergency",
    "sick",
    "accident",
    "dead",
    "in danger",
    "stuck",
    "need you",
    "trust you",
    "only you can",
  ];

  // Phase 3: Request for Action (Money, Personal Info, Login)
  const actionKeywords = [
    "money",
    "send money",
    "wire transfer",
    "transfer",
    "wire",
    "bitcoin",
    "gift card",
    "password",
    "pin",
    "account number",
    "bank details",
    "credit card",
    "verify",
    "confirm",
    "code",
    "login",
    "itunes",
    "amazon",
  ];

  let phase = "unknown";
  let matchedKeywords = [];
  let score = 0;

  // Count keyword matches for each phase
  const trustMatches = trustBuildingKeywords.filter((kw) =>
    lowerContent.includes(kw),
  );
  const sympathyMatches = sympathyKeywords.filter((kw) =>
    lowerContent.includes(kw),
  );
  const actionMatches = actionKeywords.filter((kw) =>
    lowerContent.includes(kw),
  );

  if (actionMatches.length > 0) {
    phase = "action_request";
    matchedKeywords = actionMatches;
    score = actionMatches.length * 3; // Weighted highest
  } else if (sympathyMatches.length > 0) {
    phase = "problem_introduction";
    matchedKeywords = sympathyMatches;
    score = sympathyMatches.length * 2;
  } else if (trustMatches.length > 0) {
    phase = "trust_building";
    matchedKeywords = trustMatches;
    score = trustMatches.length * 1;
  }

  return { phase, keywords: matchedKeywords, score };
}

/**
 * Analyze transition between two messages
 * Look for escalation patterns and urgency increase
 */
function analyzeMessageTransition(prevMessage, currentMessage) {
  const prevPhase = detectMessagePhase(prevMessage.content);
  const currPhase = detectMessagePhase(currentMessage.content);

  // Timeline analysis
  const timeDiff =
    new Date(currentMessage.timestamp) - new Date(prevMessage.timestamp);
  const daysDiff = timeDiff / (1000 * 60 * 60 * 24);

  // Detect escalation
  const phaseProgression = {
    "trust_building->trust_building": true,
    "trust_building->problem_introduction": true,
    "trust_building->action_request": true,
    "problem_introduction->action_request": true,
    "problem_introduction->problem_introduction": "if_more_urgent",
    "action_request->action_request": true,
  };

  const transitionKey = `${prevPhase.phase}->${currPhase.phase}`;
  const isEscalation = !!phaseProgression[transitionKey];

  // Urgency indicators
  const urgencyKeywords = [
    "urgent",
    "asap",
    "immediately",
    "now",
    "quickly",
    "hurry",
  ];
  const currentUrgency = urgencyKeywords.filter((kw) =>
    currentMessage.content.toLowerCase().includes(kw),
  ).length;

  // Length change (longer emotionally manipulative messages)
  const prevLength = prevMessage.content ? prevMessage.content.length : 0;
  const currLength = currentMessage.content ? currentMessage.content.length : 0;
  const lengthRatio = prevLength > 0 ? currLength / prevLength : 1;

  // Repetition detection (asking same thing multiple times)
  const isSimilarContent =
    calculateStringSimilarity(prevMessage.content, currentMessage.content) >
    0.6;

  return {
    fromPhase: prevPhase.phase,
    toPhase: currPhase.phase,
    isEscalation,
    type: transitionKey,
    urgency: currentUrgency,
    timeGap: daysDiff,
    lengthRatio,
    isSimilarContent,
    riskIndicators: {
      emotionalManipulation:
        currPhase.phase === "problem_introduction" && currentUrgency > 0,
      repetitiveRequest:
        isSimilarContent && transitionKey.includes("action_request"),
      rapidEscalation: daysDiff < 1 && isEscalation,
    },
  };
}

/**
 * Calculate time span of conversation in days
 */
function calculateTimespan(messageChain) {
  if (messageChain.length < 2) return 0;
  const first = new Date(messageChain[0].timestamp);
  const last = new Date(messageChain[messageChain.length - 1].timestamp);
  return (last - first) / (1000 * 60 * 60 * 24);
}

/**
 * Calculate escalation risk from phase progression
 * Rapid progression = higher risk
 */
function calculateEscalationRisk(escalationPhases) {
  let risk = 0;

  escalationPhases.forEach((phase, index) => {
    // Each escalation phase adds base risk
    risk += 20;

    // Rapid escalation (within 24 hours) adds more risk
    if (
      phase.escalationType === "trust_building->action_request" &&
      index === 0
    ) {
      risk += 30; // Direct jump to money request = strong scam indicator
    }

    // Higher urgency = higher risk
    risk += phase.urgencyLevel * 10;

    // Emotional manipulation escalations are high risk
    if (phase.escalationType === "problem_introduction->action_request") {
      risk += 15;
    }
  });

  // Cap at 100
  return Math.min(risk, 100);
}

/**
 * Calculate confidence in escalation detection
 * More patterns = higher confidence
 */
function calculateConfidence(patterns) {
  const escalationPatterns = patterns.filter((p) => p.isEscalation);
  const totalPatterns = patterns.length;

  if (totalPatterns === 0) return 0;

  const escalationRatio = escalationPatterns.length / totalPatterns;

  // More escalations = higher confidence
  // But also consider if patterns are consistent
  const consistentEscalations =
    escalationPatterns.length > 0
      ? Math.min(escalationPatterns.length / 3, 1)
      : 0;

  return (escalationRatio * 0.6 + consistentEscalations * 0.4).toFixed(2);
}

/**
 * Simple string similarity using character overlap
 * Returns 0-1 similarity score
 */
function calculateStringSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().split(" ");
  const s2 = str2.toLowerCase().split(" ");

  const matches = s1.filter((word) => s2.includes(word)).length;
  const total = Math.max(s1.length, s2.length);

  return total === 0 ? 0 : matches / total;
}

/**
 * Classify conversation context by analyzing all messages
 * Returns: "romance" | "business" | "support" | "unknown"
 */
function classifyConversationContext(messageChain) {
  if (!messageChain || messageChain.length === 0) return "unknown";

  const allContent = messageChain
    .map((m) => (m.content || "").toLowerCase())
    .join(" ");

  const romanticKeywords = [
    "love",
    "miss you",
    "marry",
    "relationship",
    "dating",
    "boyfriend",
    "girlfriend",
    "heart",
  ];
  const businessKeywords = [
    "business",
    "order",
    "product",
    "price",
    "invoice",
    "contract",
    "deal",
    "payment",
  ];
  const supportKeywords = [
    "support",
    "help",
    "issue",
    "problem",
    "ticket",
    "error",
    "account",
    "verify",
  ];

  const romanticScore = romanticKeywords.filter((kw) =>
    allContent.includes(kw),
  ).length;
  const businessScore = businessKeywords.filter((kw) =>
    allContent.includes(kw),
  ).length;
  const supportScore = supportKeywords.filter((kw) =>
    allContent.includes(kw),
  ).length;

  if (romanticScore > businessScore && romanticScore > supportScore)
    return "romance";
  if (businessScore > romanticScore && businessScore > supportScore)
    return "business";
  if (supportScore > romanticScore && supportScore > businessScore)
    return "support";

  return "unknown";
}

/**
 * Get conversation risk summary
 * Combines all analysis into actionable summary
 */
function getConversationRiskSummary(analysis) {
  let riskLevel = "safe";
  let recommendation = "No escalation detected";

  if (analysis.riskScore >= 70) {
    riskLevel = "critical";
    recommendation =
      "High escalation risk - likely scam. Flag and review immediately.";
  } else if (analysis.riskScore >= 50) {
    riskLevel = "high";
    recommendation =
      "Moderate escalation detected. May be scam progression. Monitor closely.";
  } else if (analysis.riskScore >= 30) {
    riskLevel = "medium";
    recommendation =
      "Some escalation patterns detected. Context-dependent assessment needed.";
  } else if (analysis.escalationDetected) {
    riskLevel = "low";
    recommendation =
      "Minor escalation patterns. Likely low risk but stay alert.";
  }

  return {
    riskLevel,
    riskScore: analysis.riskScore,
    confidence: analysis.confidence,
    recommendation,
    escalationPhaseCount: analysis.escalationPhases.length,
    contextType: analysis.contextType,
  };
}

module.exports = {
  analyzeConversationContext,
  detectMessagePhase,
  analyzeMessageTransition,
  classifyConversationContext,
  getConversationRiskSummary,
};
