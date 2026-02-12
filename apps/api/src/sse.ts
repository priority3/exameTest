import type { FastifyReply, FastifyRequest } from "fastify";

const isAllowedOrigin = (origin: string): boolean => {
  return /^http:\/\/localhost:\d+$/.test(origin) || /^http:\/\/127\.0\.0\.1:\d+$/.test(origin);
};

export const initSse = (req: FastifyRequest, reply: FastifyReply) => {
  // CORS: Fastify's CORS plugin usually sets these headers in onSend hooks,
  // but `reply.hijack()` bypasses that pipeline. For SSE we set the headers
  // explicitly so EventSource can connect cross-origin (localhost:3000 -> :4000).
  const originHeader = req.headers?.origin;
  const origin = typeof originHeader === "string" ? originHeader : "";
  if (origin && isAllowedOrigin(origin)) {
    reply.raw.setHeader("Access-Control-Allow-Origin", origin);
    reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
    reply.raw.setHeader("Vary", "Origin");
  }

  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  // Helps when running behind reverse proxies (nginx) to avoid buffering.
  reply.raw.setHeader("X-Accel-Buffering", "no");

  // Flush headers so the client receives them immediately.
  // (Node's http server supports flushHeaders on ServerResponse.)
  if (typeof (reply.raw as any).flushHeaders === "function") {
    (reply.raw as any).flushHeaders();
  }
};

export const sseSend = (reply: FastifyReply, params: { event?: string; data: unknown }) => {
  if (params.event) {
    reply.raw.write(`event: ${params.event}\n`);
  }
  reply.raw.write(`data: ${JSON.stringify(params.data)}\n\n`);
};

export const sseComment = (reply: FastifyReply, comment: string) => {
  reply.raw.write(`: ${comment}\n\n`);
};
