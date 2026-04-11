const DEFAULT_NOTIFICATION_PREFERENCES = {
  channels: {
    email: true,
    sms: false,
    inApp: true,
  },
  offline: {
    subscribed: false,
    phoneNumber: "",
    gatewayDomain: "",
    fallbackToEmail: true,
    verifiedAt: null,
  },
  eventTypes: {
    security: true,
    billing: true,
    matches: true,
    messages: false,
    system: true,
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "06:00",
    timezone: "Africa/Lagos",
  },
  digestMode: "instant",
};

const cloneDefaults = () =>
  JSON.parse(JSON.stringify(DEFAULT_NOTIFICATION_PREFERENCES));

const normalizePhoneNumber = (phoneNumber) => {
  const digitsOnly = String(phoneNumber || "").replace(/\D/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.length < 7 || digitsOnly.length > 15) return "";
  return digitsOnly;
};

const normalizeGatewayDomain = (gatewayDomain) => {
  const normalized = String(gatewayDomain || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";

  const safePattern = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
  if (!safePattern.test(normalized)) {
    return "";
  }

  return normalized;
};

const sanitizeTime = (value, fallback) => {
  const text = String(value || "").trim();
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(text)) {
    return fallback;
  }
  return text;
};

const mergeNotificationPreferences = (incoming = {}, existing = {}) => {
  const defaults = cloneDefaults();
  const merged = {
    ...defaults,
    ...existing,
    ...incoming,
    channels: {
      ...defaults.channels,
      ...(existing.channels || {}),
      ...(incoming.channels || {}),
    },
    offline: {
      ...defaults.offline,
      ...(existing.offline || {}),
      ...(incoming.offline || {}),
    },
    eventTypes: {
      ...defaults.eventTypes,
      ...(existing.eventTypes || {}),
      ...(incoming.eventTypes || {}),
    },
    quietHours: {
      ...defaults.quietHours,
      ...(existing.quietHours || {}),
      ...(incoming.quietHours || {}),
    },
  };

  merged.channels.email = Boolean(merged.channels.email);
  merged.channels.sms = Boolean(merged.channels.sms);
  merged.channels.inApp = Boolean(merged.channels.inApp);

  merged.offline.phoneNumber = normalizePhoneNumber(merged.offline.phoneNumber);
  merged.offline.gatewayDomain = normalizeGatewayDomain(
    merged.offline.gatewayDomain,
  );
  merged.offline.fallbackToEmail = Boolean(merged.offline.fallbackToEmail);

  if (!merged.offline.phoneNumber || !merged.offline.gatewayDomain) {
    merged.offline.subscribed = false;
  } else {
    merged.offline.subscribed = Boolean(merged.offline.subscribed);
  }

  merged.eventTypes.security = Boolean(merged.eventTypes.security);
  merged.eventTypes.billing = Boolean(merged.eventTypes.billing);
  merged.eventTypes.matches = Boolean(merged.eventTypes.matches);
  merged.eventTypes.messages = Boolean(merged.eventTypes.messages);
  merged.eventTypes.system = Boolean(merged.eventTypes.system);

  merged.quietHours.enabled = Boolean(merged.quietHours.enabled);
  merged.quietHours.start = sanitizeTime(
    merged.quietHours.start,
    defaults.quietHours.start,
  );
  merged.quietHours.end = sanitizeTime(
    merged.quietHours.end,
    defaults.quietHours.end,
  );
  merged.quietHours.timezone =
    String(merged.quietHours.timezone || defaults.quietHours.timezone).trim() ||
    defaults.quietHours.timezone;

  merged.digestMode = merged.digestMode === "daily" ? "daily" : "instant";

  return merged;
};

const resolveEventCategory = (eventType = "") => {
  const normalized = String(eventType || "").toLowerCase();
  if (normalized.startsWith("auth.")) return "security";
  if (
    normalized.startsWith("payment.") ||
    normalized.startsWith("subscription.") ||
    normalized.startsWith("trial.")
  ) {
    return "billing";
  }
  if (normalized.startsWith("match.")) return "matches";
  if (normalized.startsWith("message.")) return "messages";
  return "system";
};

const isCriticalEvent = (eventType = "") => {
  const normalized = String(eventType || "").toLowerCase();
  return (
    normalized === "auth.two_factor_requested" ||
    normalized === "auth.password_reset_requested" ||
    normalized === "auth.password_reset_completed" ||
    normalized === "auth.email_verification_requested"
  );
};

const isWithinQuietHours = (quietHours, now = new Date()) => {
  if (!quietHours?.enabled) return false;

  const toMinutes = (value) => {
    const [h, m] = String(value || "00:00")
      .split(":")
      .map((part) => Number(part));
    return h * 60 + m;
  };

  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);
  const current = now.getHours() * 60 + now.getMinutes();

  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  return current >= start || current < end;
};

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  mergeNotificationPreferences,
  normalizePhoneNumber,
  normalizeGatewayDomain,
  resolveEventCategory,
  isCriticalEvent,
  isWithinQuietHours,
};
