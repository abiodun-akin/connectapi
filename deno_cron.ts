const RABBITMQ_HTTP_API = Deno.env.get("RABBITMQ_HTTP_API") || "";
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
  if (!template) return;

  try {
    await fetch("https://api.resend.com/emails", {
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
    console.log(`Email sent for ${eventType} to ${email}`);
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

async function processMessages() {
  try {
    const auth = btoa(`${RABBITMQ_USER}:${RABBITMQ_PASS}`);
    const apiUrl = RABBITMQ_HTTP_API.endsWith("/")
      ? RABBITMQ_HTTP_API
      : `${RABBITMQ_HTTP_API}/`;
    const response = await fetch(`${apiUrl}queues`, {
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    const queues = (await response.json()) as Array<{ name: string }>;
    const targetQueues = ["auth_notifications", "payment_notifications"];

    for (const queue of queues) {
      if (!targetQueues.includes(queue.name)) continue;

      const msgResponse = await fetch(`${apiUrl}queues/%2F/${queue.name}/get`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ackmode: "ack_requeue_true", count: 100 }),
      });

      const messages = (await msgResponse.json()) as Array<{
        payload: string;
        properties: { routing_key: string };
      }>;
      for (const msg of messages) {
        const data = JSON.parse(atob(msg.payload)) as Record<string, unknown>;
        await sendEmail(data.email as string, msg.properties.routing_key, data);
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
