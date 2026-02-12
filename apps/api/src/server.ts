import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerPaperRoutes } from "./routes/papers.js";
import { registerAttemptRoutes } from "./routes/attempts.js";

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/],
  credentials: true
});

app.get("/health", async () => {
  return { ok: true };
});

await registerSourceRoutes(app);
await registerPaperRoutes(app);
await registerAttemptRoutes(app);

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
