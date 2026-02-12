import type { FastifyReply } from "fastify";

export const initSse = (reply: FastifyReply) => {
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

