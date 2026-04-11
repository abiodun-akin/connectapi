/**
 * Message Analyzer - Rate-Limiting Detection Module
 * Path D: Advanced Functionality
 *
 * Detects suspicious sending patterns:
 * - Same message to multiple recipients (spam/mass scam)
 * - Rapid-fire messaging (bot-like behavior)
 * - Credential stuffing patterns (repeated login attempts)
 * - Copy-paste template messages (campaign detection)
 */

/**
 * Analyze user's message sending patterns for rate-limit violations
 * @param {String} userId - Sender's user ID
 * @param {Array} recentMessages - Recent messages sent by user (last 24-48 hours)
 * @param {Object} options - { timeWindowHours: 24, thresholds: {...} }
 * @returns {Object} Rate-limit analysis with risk score and patterns detected
 */
async function analyzeUserRateLimiting(userId, recentMessages, options = {}) {
  const defaults = {
    timeWindowHours: 24,
    maxMessagesPerHour: 10,
    maxRecipientsPerHour: 5,
    similarityThreshold: 0.75,
  };

  const config = {
    ...defaults,
    ...(options || {}),
    ...(options.thresholds || {}),
  };

  if (!recentMessages || recentMessages.length === 0) {
    return {
      userId,
      violations: [],
      riskScore: 0,
      suspicious: false,
      patterns: [],
    };
  }

  const analysis = {
    userId,
    timeWindow: config.timeWindowHours,
    totalMessages: recentMessages.length,
    uniqueRecipients: new Set(recentMessages.map((m) => m.recipient_id)).size,
    violations: [],
    riskScore: 0,
    suspicious: false,
    patterns: [],
    details: {},
  };

  // 1. Check messaging frequency (messages per hour)
  const frequencyViolation = checkMessagingFrequency(recentMessages, config);
  if (frequencyViolation.violated) {
    analysis.violations.push(frequencyViolation);
    analysis.patterns.push("rapid_messaging");
  }

  // 2. Check recipient diversity (how many unique recipients in time window)
  const recipientViolation = checkRecipientDiversity(recentMessages, config);
  if (recipientViolation.violated) {
    analysis.violations.push(recipientViolation);
    analysis.patterns.push("mass_recipient_targeting");
  }

  // 3. Detect template/copy-paste messages (template reuse detection)
  const templateViolation = detectTemplateMessages(recentMessages, config);
  if (templateViolation.detected) {
    analysis.violations.push(templateViolation);
    analysis.patterns.push("template_reuse");
  }

  // 4. Detect credential stuffing behavior (repeated failed access patterns)
  const credentialViolation = detectCredentialStuffing(recentMessages);
  if (credentialViolation.detected) {
    analysis.violations.push(credentialViolation);
    analysis.patterns.push("credential_stuffing");
  }

  // 5. Detect bot-like behavior signatures
  const botViolation = detectBotBehavior(recentMessages);
  if (botViolation.detected) {
    analysis.violations.push(botViolation);
    analysis.patterns.push("bot_like_behavior");
  }

  // Calculate overall risk score
  analysis.riskScore = calculateRateLimitRisk(analysis.violations);
  analysis.suspicious = analysis.riskScore >= 50;
  analysis.details = generateRateLimitDetails(analysis);

  return analysis;
}

/**
 * Check if user is sending messages too frequently
 */
function checkMessagingFrequency(messages, config) {
  const now = new Date();
  const hourAgo = new Date(now - config.timeWindowHours * 60 * 60 * 1000);

  const recentCount = messages.filter(
    (m) => new Date(m.createdAt || m.timestamp) > hourAgo,
  ).length;

  const messagesPerHour =
    config.timeWindowHours > 0
      ? recentCount / config.timeWindowHours
      : recentCount;

  const violated = messagesPerHour > config.maxMessagesPerHour;

  const sorted = [...messages].sort(
    (a, b) =>
      new Date(a.createdAt || a.timestamp) -
      new Date(b.createdAt || b.timestamp),
  );
  let maxBurstCount = 0;

  for (let i = 0; i < sorted.length; i++) {
    const startTime = new Date(
      sorted[i].createdAt || sorted[i].timestamp,
    ).getTime();
    let windowCount = 1;
    for (let j = i + 1; j < sorted.length; j++) {
      const currentTime = new Date(
        sorted[j].createdAt || sorted[j].timestamp,
      ).getTime();
      if (currentTime - startTime <= 60 * 60 * 1000) {
        windowCount += 1;
      } else {
        break;
      }
    }
    if (windowCount > maxBurstCount) {
      maxBurstCount = windowCount;
    }
  }

  const burstDetected = maxBurstCount >= config.maxMessagesPerHour;
  const isViolated = violated || burstDetected;

  const severityFromRate = Math.min(
    (messagesPerHour / config.maxMessagesPerHour) * 100,
    100,
  );
  const severityFromBurst = Math.min(
    (maxBurstCount / config.maxMessagesPerHour) * 100,
    100,
  );

  return {
    type: "messaging_frequency",
    violated: isViolated,
    severity: isViolated ? Math.max(severityFromRate, severityFromBurst) : 0,
    messagesPerHour: messagesPerHour.toFixed(2),
    burstMessagesPerHourWindow: maxBurstCount,
    threshold: config.maxMessagesPerHour,
    excessRatio: isViolated
      ? (messagesPerHour / config.maxMessagesPerHour).toFixed(2)
      : 0,
  };
}

/**
 * Check if user is targeting too many unique recipients
 * (Indicator of spam/mass scam campaign)
 */
function checkRecipientDiversity(messages, config) {
  const now = new Date();
  const timeAgo = new Date(now - config.timeWindowHours * 60 * 60 * 1000);

  const recentMessages = messages.filter(
    (m) => new Date(m.createdAt || m.timestamp) > timeAgo,
  );

  const uniqueRecipients = new Set(recentMessages.map((m) => m.recipient_id))
    .size;
  const recipientsPerHour =
    config.timeWindowHours > 0
      ? uniqueRecipients / config.timeWindowHours
      : uniqueRecipients;

  const violated = uniqueRecipients > config.maxRecipientsPerHour;

  return {
    type: "recipient_targeting",
    violated,
    severity: violated
      ? Math.min((uniqueRecipients / config.maxRecipientsPerHour) * 100, 100)
      : 0,
    uniqueRecipients,
    recipientsPerHour: recipientsPerHour.toFixed(2),
    threshold: config.maxRecipientsPerHour,
    excessRatio: violated
      ? (recipientsPerHour / config.maxRecipientsPerHour).toFixed(2)
      : 0,
  };
}

/**
 * Detect if user is sending nearly identical messages (template reuse)
 * Indicator of: spam campaigns, mass scams, bot activity
 */
function detectTemplateMessages(messages, config) {
  const messageTexts = messages
    .map((m) => m.content || "")
    .filter((c) => c.length > 20);

  if (messageTexts.length < 2) {
    return { detected: false };
  }

  const templateGroups = [];
  const processed = new Set();

  for (let i = 0; i < messageTexts.length; i++) {
    if (processed.has(i)) continue;

    const group = [i];
    processed.add(i);

    // Find similar messages
    for (let j = i + 1; j < messageTexts.length; j++) {
      if (processed.has(j)) continue;

      const similarity = calculateMessageSimilarity(
        messageTexts[i],
        messageTexts[j],
      );

      if (similarity > config.similarityThreshold) {
        group.push(j);
        processed.add(j);
      }
    }

    if (group.length > 1) {
      templateGroups.push({
        similarity: config.similarityThreshold,
        count: group.length,
        template: messageTexts[i].substring(0, 100), // First 100 chars
        messageIndices: group,
      });
    }
  }

  const detected =
    templateGroups.length > 0 && templateGroups.some((g) => g.count > 2);

  return {
    type: "template_reuse",
    detected,
    severity: detected ? Math.min(templateGroups[0].count * 15, 100) : 0, // Each duplicate adds 15%
    templateGroupsCount: templateGroups.length,
    templateGroups: templateGroups.slice(0, 3), // Top 3 groups
    indicator: detected
      ? "Mass messaging detected - likely spam/scam campaign"
      : null,
  };
}

/**
 * Detect credential stuffing patterns
 * (Repeated failed login attempts with different credentials on same system)
 */
function detectCredentialStuffing(messages) {
  const credentialKeywords = [
    "password",
    "pin",
    "login",
    "verify",
    "confirm",
    "account",
    "code",
    "2fa",
    "authenticator",
    "security question",
    "recovery",
  ];

  const credentialMessages = messages.filter((m) => {
    const content = (m.content || "").toLowerCase();
    return credentialKeywords.some((kw) => content.includes(kw));
  });

  if (credentialMessages.length < 3) {
    return { detected: false };
  }

  // Check for rapid repetition
  const timestamps = credentialMessages.map(
    (m) => new Date(m.createdAt || m.timestamp),
  );
  const timeDiffs = [];

  for (let i = 1; i < timestamps.length; i++) {
    timeDiffs.push(timestamps[i] - timestamps[i - 1]);
  }

  const avgTimeDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
  const minTimeDiff = Math.min(...timeDiffs);
  const secondsBetweenAttempts = minTimeDiff / 1000;

  const detected =
    credentialMessages.length >= 5 && secondsBetweenAttempts < 300; // Less than 5 min apart

  return {
    type: "credential_stuffing",
    detected,
    severity: detected
      ? Math.min((credentialMessages.length / 5) * 100, 100)
      : 0,
    credentialRequestCount: credentialMessages.length,
    minSecondsBetween: secondsBetweenAttempts.toFixed(1),
    indicator: detected
      ? "Rapid credential requests - possible account takeover attempt"
      : null,
  };
}

/**
 * Detect bot-like behavior signatures
 * - Perfect timing (exactly spaced messages)
 * - No variation in message structure
 * - Excessive use of shortcodes or patterns
 */
function detectBotBehavior(messages) {
  if (messages.length < 5) {
    return { detected: false };
  }

  const timestamps = messages.map((m) => new Date(m.createdAt || m.timestamp));
  const timeDiffs = [];

  for (let i = 1; i < timestamps.length; i++) {
    timeDiffs.push(timestamps[i] - timestamps[i - 1]);
  }

  // Calculate timing regularity (low variance = bot-like)
  const avgDiff = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
  const variance =
    timeDiffs.reduce((sum, diff) => {
      return sum + Math.pow(diff - avgDiff, 2);
    }, 0) / timeDiffs.length;
  const stdDev = Math.sqrt(variance);
  const regularityScore = stdDev / avgDiff; // Lower = more regular = more bot-like

  // Check for repeated phrases/patterns
  const contents = messages.map((m) => m.content || "");
  const phraseCounts = {};

  contents.forEach((content) => {
    const words = content.split(" ");
    words.forEach((word) => {
      if (word.length > 3) {
        phraseCounts[word] = (phraseCounts[word] || 0) + 1;
      }
    });
  });

  const repeatedPhrases = Object.values(phraseCounts).filter(
    (count) => count > 3,
  ).length;

  const detected = regularityScore < 0.3 || repeatedPhrases > 10;

  return {
    type: "bot_behavior",
    detected,
    severity: detected ? Math.min((repeatedPhrases / 5) * 100, 100) : 0,
    timingRegularity: (1 - regularityScore).toFixed(2), // Inverted for clarity
    repeatedPhrasesCount: repeatedPhrases,
    indicator: detected
      ? "Bot-like behavior detected - robotic messaging pattern"
      : null,
  };
}

/**
 * Calculate similarity between two messages (0-1 scale)
 * Uses word overlap and length similarity
 */
function calculateMessageSimilarity(msg1, msg2) {
  if (!msg1 || !msg2) return 0;

  const words1 = new Set(msg1.toLowerCase().match(/\b\w+\b/g) || []);
  const words2 = new Set(msg2.toLowerCase().match(/\b\w+\b/g) || []);

  if (words1.size === 0 || words2.size === 0) return 0;

  // Jaccard similarity (intersection / union)
  const intersection = new Set([...words1].filter((x) => words2.has(x)));
  const union = new Set([...words1, ...words2]);

  const jaccardSimilarity = intersection.size / union.size;

  // Weight by length similarity
  const lengthSimilarity =
    Math.min(msg1.length, msg2.length) / Math.max(msg1.length, msg2.length);

  // Combined score: 70% word similarity, 30% length similarity
  return jaccardSimilarity * 0.7 + lengthSimilarity * 0.3;
}

/**
 * Calculate overall rate-limit risk score
 */
function calculateRateLimitRisk(violations) {
  let risk = 0;

  violations.forEach((violation) => {
    risk += violation.severity || 0;
  });

  // Average across violations
  if (violations.length > 0) {
    risk = risk / violations.length;
  }

  return Math.min(risk, 100);
}

/**
 * Generate human-readable rate-limit details
 */
function generateRateLimitDetails(analysis) {
  const details = {
    summary: `User sent ${analysis.totalMessages} messages to ${analysis.uniqueRecipients} recipients in last ${analysis.timeWindow} hours`,
    riskLevel:
      analysis.riskScore >= 70
        ? "critical"
        : analysis.riskScore >= 50
          ? "high"
          : analysis.riskScore >= 30
            ? "medium"
            : "low",
    detectedPatterns: analysis.patterns,
    actionableSuggestions: [],
  };

  if (analysis.patterns.includes("rapid_messaging")) {
    details.actionableSuggestions.push(
      "Rate limit: Consider blocking rapid message sending",
    );
  }
  if (analysis.patterns.includes("mass_recipient_targeting")) {
    details.actionableSuggestions.push(
      "Review: User targeting many recipients rapidly (possible spam)",
    );
  }
  if (analysis.patterns.includes("template_reuse")) {
    details.actionableSuggestions.push(
      "Flag: Identical messages to multiple users (mass campaign)",
    );
  }
  if (analysis.patterns.includes("credential_stuffing")) {
    details.actionableSuggestions.push(
      "Alert: Rapid credential requests (possible account takeover)",
    );
  }
  if (analysis.patterns.includes("bot_like_behavior")) {
    details.actionableSuggestions.push(
      "Investigate: Robotic messaging patterns detected",
    );
  }

  return details;
}

module.exports = {
  analyzeUserRateLimiting,
  checkMessagingFrequency,
  checkRecipientDiversity,
  detectTemplateMessages,
  detectCredentialStuffing,
  detectBotBehavior,
  calculateMessageSimilarity,
  calculateRateLimitRisk,
  generateRateLimitDetails,
};
