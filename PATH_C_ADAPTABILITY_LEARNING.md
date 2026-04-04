# Path C: Adaptability & Learning System

**Status**: ✅ COMPLETE & TESTED (Commit: e0b8811)
**Test Coverage**: 25 new tests (16 unit + 9 integration), 100% passing

## Overview

Path C implements an **adaptive learning system** that continuously improves message analysis through admin feedback. Instead of static patterns, the system learns which patterns work best and adjusts weights accordingly.

### Core Concept

**Feedback Loop**: Admin reviews message → Decision (correct/FP/FN) → Pattern metrics updated → Weights recalculated → Next analysis uses learned weights

## Architecture

### 1. MongoDB Schemas (models/AdaptiveLearning.js)

#### AnalysisFeedbackSchema
Tracks admin decisions on message analysis.
```javascript
{
  messageId: ObjectId,
  originalAnalysis: {
    riskScore: Number,
    isSuspicious: Boolean,
    flaggedPatterns: [String]
  },
  adminDecision: "correct" | "false_positive" | "false_negative" | "partially_correct",
  adminNotes: String,
  adminId: ObjectId,
  userContext: { userId, communityId }
}
```

#### PatternEffectivenessSchema
Tracks how well each pattern performs over time.
```javascript
{
  pattern: "wire\\s+transfer",
  category: "payment",
  baseWeight: 20,
  stats: {
    totalDetections: 100,
    confirmedAccurate: 88,
    falsePositives: 12,
    falseNegatives: 5
  },
  metrics: {
    precision: 0.88,
    recall: 0.946,
    f1Score: 0.914
  },
  recommendedWeight: 30, // 20 * 1.5
  contextFactors: {
    farmContext: 0.8,
    newUser: 1.2,
    trustedUser: 0.5
  }
}
```

**Key Insight**: F1 Score determines weight multiplier
- F1 ≥ 0.9 → +50% weight (1.5x)
- F1 ≥ 0.7 → +20% weight (1.2x)
- F1 < 0.3 → -70% weight (0.3x)

#### UserReputationSchema
Tracks user history to reduce false positives for trusted users.
```javascript
{
  userId: ObjectId,
  stats: {
    totalMessages: 100,
    cleanMessages: 95,
    falseFlags: 2,
    confirmedScams: 3
  },
  reputationScore: 75, // 50 base + adjustments
  trustLevel: "trusted", // new → established → trusted → verified
  customRiskThreshold: 40 // Per-user threshold
}
```

**Trust Levels**:
- **new**: 0-5 messages, threshold 30
- **established**: 60+ reputation score, threshold 35
- **trusted**: 75+ reputation score, threshold 40
- **verified**: 85+ reputation, no false flags, threshold 50
- **flagged**: <30 reputation, threshold 20

**Reputation Formula**:
```
Score = 50                              // Base
       + (cleanRatio × 30)              // Reward clean history
       - (falseFlagRatio × 40)          // Penalize false flags
       - (confirmedScamRatio × 50)      // Penalize confirmed scams
```

#### CommunityThresholdsSchema
Region/community-specific threshold calibration.
```javascript
{
  communityId: "farming_region_1",
  baseSuspiciousThreshold: 30,
  criticalThreshold: 70,
  tolerance: {
    falsePositivePercent: 3,
    falseNegativePercent: 1
  },
  stats: {
    totalMessages: 5000,
    confirmedScams: 45,
    falsePositives: 5
  }
}
```

### 2. Learning Service (services/adaptiveLearningService.js)

#### recordAdminFeedback (Main Entry Point)
```javascript
await adaptiveLearningService.recordAdminFeedback({
  messageId: "msg123",
  adminDecision: "false_positive",
  adminNotes: "Legitimate farm equipment discussion",
  userId: "user456",
  originalAnalysis: { ... }
});
```

**Orchestrates**:
1. Save feedback to AnalysisFeedback collection
2. For each flagged pattern:
   - Update pattern stats (false positives, false negatives, etc.)
   - Recalculate precision/recall/F1
   - Calculate new recommended weight
3. Update user reputation based on decision
4. Update community statistics

#### Processing Order
```
recordAdminFeedback()
├─ Save feedback record
├─ processAdminFeedback() → Update each pattern's stats
├─ recalculatePatternMetrics() → New precision/recall/F1
├─ calculateRecommendedWeight() → Maps F1 → weight (0.3x-1.5x)
├─ updateUserReputation() → Trust level and custom threshold
└─ updateCommunityStats() → Regional metrics
```

#### getDynamicPatternWeights (Consumer Function)
Frontend calls this to get learned weights for current analysis:
```javascript
const config = await adaptiveLearningService.getAdaptiveConfiguration(
  userId, 
  communityId
);
// Returns:
{
  patternWeights: { 
    "wire transfer": 30,     // Learned width 1.5x
    "marry": 4.5,             // Learned width 0.3x
    ...
  },
  customRiskThreshold: 40,   // User-specific
  riskLevelMap: "trusted",   // Trust level
  contextFactors: {...}
}
```

#### Learning Example

**Scenario**: "marry" pattern in farm context
1. **Initial state**: Weight 15, F1 score unknown
2. **After 50 detections**: 10 correct, 40 false positives
   - Precision = 10/50 = 0.2
   - F1 score = 0.27 (low)
   - New weight = 15 × 0.3 = 4.5 (-70%)
3. **With farm context multiplier**: 4.5 × 0.8 = 3.6
4. **Result**: "marry" now contributes minimal risk in farm context

### 3. Admin API Routes (routes/adminFeedback.js)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/feedback/message-analysis` | POST | Submit feedback on analysis |
| `/api/admin/feedback/adaptive-config` | GET | Get user's adaptive configuration |
| `/api/admin/feedback/learning-stats` | GET | System health metrics |
| `/api/admin/feedback/calibrate-thresholds` | POST | Manual threshold adjustment |
| `/api/admin/feedback/pattern-effectiveness` | GET | Pattern metrics sorted by F1 |
| `/api/admin/feedback/user-reputation/:userId` | GET | User trust and history |

### 4. Message Analysis Integration (message.js)

**Pre-save hook updated**:
```javascript
messageSchema.pre("save", async function(next) {
  // ... validation ...
  
  // Path C: Get adaptive configuration
  const config = await adaptiveLearningService
    .getAdaptiveConfiguration(this.sender_id, communityId);
  
  // Analyze with learned weights
  const analysis = await analyzeMessage(this.content, {
    patternWeights: config.patternWeights,
    riskThreshold: config.customRiskThreshold,
    contextFactors: config.contextFactors
  });
  
  // Mark if adaptive weights were used
  this.aiAnalysisResult = {
    ...analysis,
    adaptiveConfig: !!config.customRiskThreshold
  };
});
```

## Test Coverage

### Unit Tests: adaptiveLearning.test.js (16 tests)

**Pattern Effectiveness Learning**:
- ✅ Track correct detections
- ✅ Calculate precision/recall/F1
- ✅ Recommend weight multipliers

**User Reputation Tracking**:
- ✅ Calculate reputation scores
- ✅ Assign trust levels
- ✅ Adjust risk thresholds per trust level

**Admin Feedback Processing**:
- ✅ Update pattern stats on correct detection
- ✅ Track false positive feedback
- ✅ Track false negative feedback

**Context-Aware Learning**:
- ✅ Learn farm context effects

**Learning System Performance**:
- ✅ Provide pattern effectiveness ratings (A+/A/B+/B/C/F)
- ✅ Track overall system improvement

**Community Threshold Calibration**:
- ✅ Adjust based on false positive rate

**Edge Cases**:
- ✅ Handle new patterns gracefully
- ✅ Prevent weight manipulation from single feedback

### Integration Tests: adaptiveIntegration.integration.test.js (9 scenarios)

**Scenario 1: False Positive Learning**
- Message incorrectly flagged → Admin marks false_positive
- System reduces "wire transfer" + "bank account" weights
- Farm context multiplier applied

**Scenario 2: True Positive Learning**
- Scam missed (false negative) → Admin confirms scam
- System lowers threshold to catch similar cases
- "wire transfer" + "urgency" patterns boosted

**Scenario 3: User Reputation Learning**
- Verified user (88 reputation) → Warning reduced by 70%
- Flagged user (15 reputation) → Warning increased by 20%

**Scenario 4: Pattern Evolution**
- Cycle 1: Weight 12 (baseline)
- Cycle 2: Weight 14.4 (+20%, improving effectiveness)
- Cycle 3: Weight 18 (+50%, excellent pattern)

**Scenario 5: Farm Context Learning**
- Patterns: "wire transfer", "marry", "urgent"
- Farm keywords detected → 60-80% weight reduction
- Romance-scam patterns converted to legitimate farm discussion

**Scenario 6: Community Threshold Calibration**
- 5% false positive rate, 3% tolerance
- System recommends raising threshold by 5 points
- Example: 30 → 35 to reduce false positives

**Scenario 7: Admin Dashboard Metrics**
- 5 patterns analyzed
- Average F1: 0.798
- Grade distribution: A+, A, B, B, F
- Identifies weak patterns for improvement

**Scenario 8: Pattern Conflict Resolution**
- Multiple feedback cycles suggest different weights
- System aggregates with voting
- Result: converges on consensus weight

**Test Results**: 9/9 passing ✅

## Key Metrics & Formulas

### Pattern Effectiveness

**Precision** (of detections, how many correct?):
```
Precision = Correct Detections / Total Detections
```

**Recall** (of actual scams, how many caught?):
```
Recall = Correct Detections / (Correct + Missed Scams)
```

**F1 Score** (harmonic mean, balances both):
```
F1 = 2 × (Precision × Recall) / (Precision + Recall)
```

### Weight Adjustment
```
Recommended Weight = Base Weight × Multiplier

Where Multiplier based on F1:
- F1 ≥ 0.9  → 1.5x (excellent)
- F1 ≥ 0.7  → 1.2x (good)
- F1 ≥ 0.5  → 1.0x (acceptable)
- F1 ≥ 0.3  → 0.7x (weak)
- F1 < 0.3  → 0.3x (very weak)
```

### User Reputation Score
```
Score = 50 Base
      + (Clean Messages / Total × 30)              [max +30]
      - (False Flags / Total × 40)                 [max -40]
      - (Confirmed Scams / Total × 50)             [max -50]

Range: 0-100
```

## Farm Context Multipliers

Applied to reduce false positives in agricultural context:

| Pattern | Context | Multiplier | Effect |
|---------|---------|-----------|--------|
| "wire transfer" | Farm payment | 0.3x | Reduced 70% |
| "marry" | Farm agreement | 0.3x | Reduced 70% |
| "urgent" | Limited offer | 0.6x | Reduced 40% |
| "password" | Farm account | 0.4x | Reduced 60% |

## Deployment Notes

### Database Indexes
```javascript
// Required for performance:
AnalysisFeedback.createIndex({ messageId: 1 });
AnalysisFeedback.createIndex({ adminId: 1, createdAt: -1 });

PatternEffectiveness.createIndex({ pattern: 1, category: 1 });

UserReputation.createIndex({ userId: 1 });
UserReputation.createIndex({ trustLevel: 1 });

CommunityThresholds.createIndex({ communityId: 1 });
```

### Configuration
Add to `.env`:
```
ADAPTIVE_LEARNING_ENABLED=true
LEARNING_SERVICE_TIMEOUT=5000
PATTERN_UPDATE_BATCH_SIZE=100
AUTO_CALIBRATE_INTERVAL=604800000  # 7 days
```

## Next Steps (Future Enhancements)

1. **Admin Dashboard UI** (React component)
   - Feedback submission form
   - Pattern effectiveness visualization
   - User reputation dashboard
   - Learning statistics charts

2. **Automated Calibration**
   - Scheduler runs threshold calibration weekly
   - Alerts on significant metric changes

3. **Advanced Learning**
   - Machine learning model training
   - Pattern clustering and discovery
   - Anomaly detection

4. **Analytics & Reporting**
   - Learning progress over time
   - Pattern effectiveness trends
   - Community-level insights

## Summary

**Path C** successfully implements continuous learning for FarmConnect's message analyzer. Admin feedback directly improves pattern weights through F1-score-based algorithms, user reputation reduces false positives for trusted users, and community thresholds auto-calibrate based on regional feedback patterns.

**Key Achievement**: System that improves itself through honest admin feedback rather than static rules.

---

**Commit**: e0b8811  
**Created**: Path C - Adaptive Learning System  
**Tests**: 25 new tests (100% passing)  
**Integration**: message.js pre-save hook updated for adaptive weights  
**Status**: Ready for admin dashboard UI development
