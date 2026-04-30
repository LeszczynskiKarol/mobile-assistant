import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { voiceRoutes } from "./routes/voice.js";
import { conversationRoutes } from "./routes/conversations.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

// ── 🔒 Auth na wszystkie /api/* endpointy ─────────────────────
app.addHook("onRequest", async (req, reply) => {
  // Publiczne endpointy — bez auth
  if (req.url === "/health") return;
  if (!req.url.startsWith("/api")) return;

  const token = process.env.VOICE_API_TOKEN;
  if (!token) {
    return reply
      .status(500)
      .send({ error: "VOICE_API_TOKEN not configured on server" });
  }

  const authHeader = req.headers.authorization;
  const queryToken = req.query?.token;
  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : queryToken;

  if (provided !== token) {
    return reply
      .status(401)
      .send({ error: "Unauthorized — bad or missing VOICE_API_TOKEN" });
  }
});

// Rejestruj route'y
await app.register(voiceRoutes, { prefix: "/api" });
await app.register(conversationRoutes, { prefix: "/api" });

app.get("/health", () => ({ status: "ok", ts: Date.now() }));

const port = parseInt(process.env.PORT || "3500");
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`Voice assistant running on ${host}:${port}`);
  app.log.info(`Endpoints:`);
  app.log.info(`  POST /api/voice`);
  app.log.info(`  GET  /api/conversations`);
  app.log.info(`  GET  /api/conversations/:id`);
  app.log.info(`  PUT  /api/conversations/:id`);
  app.log.info(`  DELETE /api/conversations/:id`);
  app.log.info(`  GET  /api/search?q=...`);
  app.log.info(`  GET  /api/stats`);
  app.log.info(`  GET  /health`);
});
