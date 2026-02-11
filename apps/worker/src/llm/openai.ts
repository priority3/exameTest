import OpenAI from "openai";
import { env } from "../env.js";

let _client: OpenAI | null = null;

export type ZodLikeSchema<T> = {
  parse: (input: unknown) => T;
};

export const hasOpenAI = (): boolean => Boolean(env.OPENAI_API_KEY);

export const getOpenAI = (): OpenAI => {
  if (!_client) {
    if (!env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    const rawBaseURL = env.OPENAI_BASE_URL?.trim() || "";
    let baseURL: string | undefined = rawBaseURL || undefined;

    // Many OpenAI-compatible providers expose endpoints under `/v1`.
    // If the configured URL has no path (or just "/"), we auto-append `/v1`
    // to reduce common misconfiguration.
    if (baseURL) {
      try {
        const u = new URL(baseURL);
        if (u.pathname === "" || u.pathname === "/") {
          u.pathname = "/v1";
        }
        baseURL = u.toString().replace(/\/+$/, "");
      } catch {
        // ignore URL parse errors; let the OpenAI SDK handle it.
      }
    }
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL });
  }
  return _client;
};

const extractJsonObject = (input: string): string => {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model output");
  }
  return input.slice(start, end + 1);
};

const extractTextFromResponse = (response: any): string => {
  // OpenAI official API often returns `output_text` (or the SDK may provide it).
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  // Some OpenAI-compatible providers omit `output_text` and only return `output[]`.
  const output = response?.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const item of output) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === "string" && c.text.trim()) parts.push(c.text.trim());
        else if (typeof c?.output_text === "string" && c.output_text.trim()) parts.push(c.output_text.trim());
      }
    }
    const joined = parts.join("\n").trim();
    if (joined) return joined;
  }

  // Fallback for Chat Completions-style responses.
  const chatContent = response?.choices?.[0]?.message?.content;
  if (typeof chatContent === "string" && chatContent.trim()) return chatContent.trim();

  const completionText = response?.choices?.[0]?.text;
  if (typeof completionText === "string" && completionText.trim()) return completionText.trim();

  return "";
};

export const chatJson = async <T>(
  params: {
    system: string;
    user: string;
    schema: ZodLikeSchema<T>;
    temperature?: number;
  }
): Promise<T> => {
  const client = getOpenAI();

  // NOTE: Some OpenAI-compatible providers error when `input` is a plain string.
  // The most portable format is a chat-like list of input items.
  const input: any[] = [];
  if (params.system?.trim()) {
    input.push({ role: "system", content: params.system });
  }
  input.push({ role: "user", content: params.user });

  const model = env.OPENAI_CHAT_MODEL;

  // NOTE: Some providers partially implement the OpenAI API and error on
  // extra params (we've seen 400 upstream_error when `temperature` is sent).
  // We try the full request first, then retry with a minimal payload.
  let response: any;
  try {
    const request: any = { model, input };
    if (typeof params.temperature === "number") request.temperature = params.temperature;
    response = await client.responses.create(request);
  } catch (err) {
    const status = (err as any)?.status;
    const errType = (err as any)?.error?.type;
    const mayRetry = status === 400 && errType === "upstream_error" && typeof params.temperature === "number";
    if (!mayRetry) throw err;

    // Retry without temperature.
    response = await client.responses.create({ model, input } as any);
  }

  const content = extractTextFromResponse(response);
  if (!content) {
    const debug = {
      responseKeys: response ? Object.keys(response) : [],
      status: response?.status ?? null,
      outputLen: Array.isArray(response?.output) ? response.output.length : null,
      error: response?.error ?? null,
      incompleteDetails: response?.incomplete_details ?? null
    };
    throw new Error(`LLM returned empty output_text. Debug=${JSON.stringify(debug)}`);
  }
  const jsonText = extractJsonObject(content);
  const parsed = JSON.parse(jsonText) as unknown;
  return params.schema.parse(parsed);
};

export const embedTexts = async (texts: string[]): Promise<number[][]> => {
  const client = getOpenAI();
  const res = await client.embeddings.create({
    model: env.OPENAI_EMBEDDING_MODEL,
    input: texts
  });
  return res.data.map((d) => d.embedding);
};
