// RabbitMQ management HTTP API base (do not include trailing /api)
// Default to localhost management port if not provided (useful for local testing)
const RABBITMQ_HTTP_API =
  Deno.env.get("RABBITMQ_HTTP_API") || "http://localhost:15672";
const RABBITMQ_URL = Deno.env.get("RABBITMQ_URL") || "";
const RABBITMQ_USER = Deno.env.get("RABBITMQ_USER") || "";
const RABBITMQ_PASS = Deno.env.get("RABBITMQ_PASS") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL") || "";

const emailTemplates: Record<string, { subject: string; html: string }> = {
  "auth.signup": {
    subject: "Welcome to Farm Connect!",
    html: "<h1>Welcome!</h1><p>Your account has been created successfully.</p>",
  },
  "auth.login": {
    subject: "Login Successful",
    html: "<h1>Login Successful</h1><p>You have logged in to your account.</p>",
  },
  "auth.logout": {
    subject: "Logged Out",
    html: "<h1>Logged Out</h1><p>You have been logged out.</p>",
  },
  "payment.initialized": {
    subject: "Payment Started",
    html: "<h1>Payment Started</h1><p>Your payment process has started.</p>",
  },
  "payment.verified": {
    subject: "Payment Verified",
    html: "<h1>Payment Verified</h1><p>Your payment has been verified.</p>",
  },
  "payment.success": {
    subject: "Payment Successful",
    html: "<h1>Payment Successful</h1><p>Your payment was completed successfully.</p>",
  },
  "payment.closed": {
    subject: "Payment Cancelled",
    html: "<h1>Payment Cancelled</h1><p>Your payment process was cancelled.</p>",
  },
};

async function sendEmail(
  email: string,
  eventType: string,
  data: Record<string, unknown>
) {
  const template = emailTemplates[eventType];
  if (!template) {
    console.warn(`No email template for eventType=${eventType}`);
    return;
  }

  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    console.error(
      "Resend configuration missing: set RESEND_API_KEY and RESEND_FROM_EMAIL"
    );
    return;
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM_EMAIL,
        to: email,
        subject: template.subject,
        html: template.html,
      }),
    });

    const respText = await resp.text().catch(() => "");
    if (!resp.ok) {
      console.error(
        `Resend API error ${resp.status}: ${resp.statusText} ${respText}`
      );
    } else {
      console.log(
        `Email sent for ${eventType} to ${email} (resend status=${resp.status})`
      );
    }
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

async function processMessages() {
  try {
    if (!RABBITMQ_HTTP_API) throw new Error("RABBITMQ_HTTP_API must be set");
    if (!RABBITMQ_USER || !RABBITMQ_PASS)
      throw new Error("RABBITMQ_USER and RABBITMQ_PASS must be set");

    const auth = btoa(`${RABBITMQ_USER}:${RABBITMQ_PASS}`);

    // Determine management API base. Prefer explicit RABBITMQ_HTTP_API.
    // If it's unset or still the localhost default in deploy, try to derive
    // the management host from the AMQP URL (`RABBITMQ_URL`).
    let apiBase = RABBITMQ_HTTP_API.replace(/\/+$/g, "");
    if ((!apiBase || apiBase === "http://localhost:15672") && RABBITMQ_URL) {
      try {
        const parsed = new URL(RABBITMQ_URL);
        const proto = parsed.protocol === "amqps:" ? "https" : "http";
        const host = parsed.hostname;
        // default management port 15672
        apiBase = `${proto}://${host}:15672`;
        console.log(
          `Derived RabbitMQ HTTP API from RABBITMQ_URL -> ${apiBase}`
        );
      } catch (err) {
        console.warn("Failed to derive management API from RABBITMQ_URL:", err);
      }
    }
    const apiUrl = apiBase.endsWith("/api") ? `${apiBase}/` : `${apiBase}/api/`;

    // Non-sensitive diagnostics for debugging: presence of required config
    console.log("Cron diagnostics: env presence ->", {
      RABBITMQ_HTTP_API: !!RABBITMQ_HTTP_API,
      RABBITMQ_USER: !!RABBITMQ_USER,
      RABBITMQ_PASS: !!RABBITMQ_PASS,
      RESEND_API_KEY: !!RESEND_API_KEY,
      RESEND_FROM_EMAIL: !!RESEND_FROM_EMAIL,
      apiUrl,
    });

    // GET list of queues
    const response = await fetch(`${apiUrl}queues`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `RabbitMQ /queues returned ${response.status}: ${response.statusText} ${text}`
      );
      return;
    }

    const queues = (await response.json()) as Array<{ name: string }>;
    console.log(`Fetched ${queues.length} queues`);
    const targetQueues = ["auth_notifications", "payment_notifications"];

    for (const queue of queues) {
      if (!targetQueues.includes(queue.name)) continue;

      const msgResponse = await fetch(`${apiUrl}queues/%2F/${queue.name}/get`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ackmode: "ack_requeue_true",
          count: 100,
          encoding: "base64",
        }),
      });

      if (!msgResponse.ok) {
        const text = await msgResponse.text().catch(() => "");
        console.error(
          `RabbitMQ /get for ${queue.name} returned ${msgResponse.status}: ${msgResponse.statusText} ${text}`
        );
        continue;
      }

      const messages = (await msgResponse.json()) as Array<{
        payload: string;
        properties: { routing_key: string };
      }>;
      console.log(
        `Fetched ${messages.length} messages from queue=${queue.name}`
      );

      for (const msg of messages) {
        let data: Record<string, unknown> | null = null;
        try {
          const decoded = atob(msg.payload);
          data = JSON.parse(decoded) as Record<string, unknown>;
        } catch (err) {
          console.error(
            `Failed to decode/parse message payload for queue=${queue.name}:`,
            err
          );
          continue;
        }

        const routing = msg.properties?.routing_key || "";
        if (!data || typeof data.email !== "string") {
          console.error(
            `Message missing email field, routing=${routing}, skipping`
          );
          continue;
        }

        try {
          await sendEmail(data.email as string, routing, data);
        } catch (err) {
          console.error("sendEmail error:", err);
        }
      }
    }

    console.log("Processed messages");
  } catch (error) {
    console.error("Cron job failed:", error);
  }
}

Deno.cron("process messages", "*/1 * * * *", processMessages);

Deno.serve(async (req) => {
  if (req.method === "POST") {
    await processMessages();
    return new Response("OK");
  }
  return new Response("Not Found", { status: 404 });
});
