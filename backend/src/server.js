import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { voiceRoutes } from "./routes/voice.js";
import { conversationRoutes } from "./routes/conversations.js";
import { uploadRoutes } from "./routes/upload.js";

const app = Fastify({
  logger: { level: "warn" },
  bodyLimit: 25 * 1024 * 1024, // 25MB for file uploads
});

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB per file
    files: 5,
  },
});

// Auth hook
app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;
  if (!req.url.startsWith("/api")) return;

  const token = process.env.VOICE_API_TOKEN;
  if (!token)
    return reply.status(500).send({ error: "VOICE_API_TOKEN not configured" });

  const authHeader = req.headers.authorization;
  const queryToken = req.query?.token;
  const provided = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : queryToken;

  if (provided !== token) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
});

await app.register(voiceRoutes, { prefix: "/api" });
await app.register(conversationRoutes, { prefix: "/api" });
await app.register(uploadRoutes, { prefix: "/api" });

app.get("/health", () => ({ status: "ok", ts: Date.now() }));

const port = parseInt(process.env.PORT || "3500");
const host = process.env.HOST || "0.0.0.0";

app.listen({ port, host }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`🎤 Voice assistant running on ${host}:${port}`);
});
