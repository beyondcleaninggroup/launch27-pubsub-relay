import http from "http";
import WebSocket from "ws";

const PUBSUB_URL = process.env.PUBSUB_URL;           // wss://pubsub.aws.launch27.com/v1/subscribe?channel=...
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; // https://hook.eu1.make.com/....
const PORT = process.env.PORT || 10000;

// Basic validation
if (!PUBSUB_URL) console.error("Missing env PUBSUB_URL");
if (!MAKE_WEBHOOK_URL) console.error("Missing env MAKE_WEBHOOK_URL");

let ws;

function startWebSocket() {
  if (!PUBSUB_URL || !MAKE_WEBHOOK_URL) return;

  ws = new WebSocket(PUBSUB_URL);

  ws.on("open", () => {
    console.log("✅ Connected to Launch27 PubSub");
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return; // ignore non-JSON (ping/pong noise)
    }

    // Expecting messages like: { event: "booking_updated", booking_id: 64855, customer_id: ... }
    if (!msg?.event || !msg?.booking_id) return;

    // Only forward relevant events (you can expand this later)
    if (!["booking_updated", "booking_created"].includes(msg.event)) return;

    const payload = {
      event: msg.event,
      booking_id: msg.booking_id,
      customer_id: msg.customer_id ?? null,
      subdomain: msg.subdomain ?? null,
      team_ids: msg.team_ids ?? null,
      next_recurring: msg.next_recurring ?? null,
      originator_id: msg.originator_id ?? null,
      received_at: new Date().toISOString()
    };

    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const t = await res.text();
        console.error("❌ Make webhook failed", res.status, t);
      } else {
        console.log("➡️ Forwarded to Make:", payload.event, payload.booking_id);
      }
    } catch (e) {
      console.error("❌ Error posting to Make webhook", e?.message || e);
    }
  });

  ws.on("close", () => {
    console.log("⚠️ PubSub disconnected. Reconnecting in 2s...");
    setTimeout(startWebSocket, 2000);
  });

  ws.on("error", (err) => {
    console.log("⚠️ PubSub error:", err?.message || err);
    try { ws.close(); } catch {}
  });
}

// Small HTTP server for Render health checks
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("launch27 pubsub relay running");
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
  startWebSocket();
});
