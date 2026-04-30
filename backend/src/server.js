import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { voiceRoutes } from './routes/voice.js';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
await app.register(voiceRoutes, { prefix: '/api' });

app.get('/health', () => ({ status: 'ok', ts: Date.now() }));

const port = parseInt(process.env.PORT || '3500');
const host = process.env.HOST || '0.0.0.0';

app.listen({ port, host }, (err) => {
  if (err) { app.log.error(err); process.exit(1); }
  app.log.info(`Voice assistant running on ${host}:${port}`);
});
