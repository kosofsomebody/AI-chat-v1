import { friendlyHttpStatus } from "./apiErrors";
import type { Message } from "./types";

const DEFAULT_MODEL = "glm-4-flash";

/** 未配置 VITE_ZHIPU_API_BASE 时使用同源路径，由 Vite 代理到智谱（避免浏览器 CORS） */
const DEFAULT_SAME_ORIGIN_BASE = "/api/zhipu";

function resolveApiBaseUrl(): string {
  const custom = import.meta.env.VITE_ZHIPU_API_BASE?.trim();
  if (custom) return custom.replace(/\/+$/, "");
  return DEFAULT_SAME_ORIGIN_BASE;
}

type ZhipuApiRole = "user" | "assistant" | "system";

interface ZhipuChatMessage {
  role: ZhipuApiRole;
  content: string;
}

interface ZhipuStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string; code?: string };
}

function getZhipuEnv(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = import.meta.env.VITE_ZHIPU_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new Error(
      "未配置 VITE_ZHIPU_API_KEY：请在项目根目录创建 .env，并写入智谱开放平台 API Key。",
    );
  }

  const baseUrl = resolveApiBaseUrl();
  const model =
    import.meta.env.VITE_ZHIPU_MODEL?.trim() || DEFAULT_MODEL;

  return { apiKey, baseUrl, model };
}

/** 将本地 Message 转为智谱 Chat API 所需的 messages（不含 timestamp，过滤空内容）*/
export function toZhipuMessages(messages: Message[]): ZhipuChatMessage[] {
  return messages
    .filter(({ content }) => content.trim() !== "")
    .map(({ role, content }) => ({ role, content }));
}

function parseSseDataLines(buffer: string): { events: string[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: string[] = [];
  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith(":")) continue;
    if (trimmed.startsWith("data:")) {
      events.push(trimmed.slice(5).trimStart());
    }
  }
  return { events, rest };
}

function extractDeltaText(chunk: ZhipuStreamChunk): string {
  const delta = chunk.choices?.[0]?.delta;
  if (!delta) return "";
  const c = delta.content;
  if (typeof c === "string" && c.length > 0) return c;
  const r = delta.reasoning_content;
  if (typeof r === "string" && r.length > 0) return r;
  return "";
}

/**
 * 调用智谱 Chat Completions，流式返回增量文本（SSE）。
 * API Key、可选 Base URL 与模型名均从环境变量读取。
 */
export async function* streamZhipuChat(
  messages: Message[],
  options?: { signal?: AbortSignal },
): AsyncGenerator<string, void, undefined> {
  const { apiKey, baseUrl, model } = getZhipuEnv();
  const url = `${baseUrl}/chat/completions`;

  const body = {
    model,
    messages: toZhipuMessages(messages),
    stream: true,
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: options?.signal,
    });
  } catch (e) {
    if (e instanceof TypeError) {
      throw new Error(
        "网络连接异常，请检查网络、代理或防火墙设置后重试。",
      );
    }
    throw e;
  }

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const errJson = (await response.json()) as {
        error?: { message?: string };
        message?: string;
      };
      detail =
        errJson.error?.message ??
        errJson.message ??
        JSON.stringify(errJson);
    } catch {
      try {
        detail = await response.text();
      } catch {
        /* ignore */
      }
    }
    throw new Error(friendlyHttpStatus(response.status, detail));
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.toLowerCase().includes("text/html")) {
    throw new Error(
      "接口返回了网页而非模型流式数据：请使用 `npm run dev` / `npm run preview` 进行本地调试；若已部署静态站点，请在网关将路径代理到智谱 API，或设置环境变量 VITE_ZHIPU_API_BASE 为可用的后端网关地址。",
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法读取模型回复，请刷新页面或稍后重试。");
  }
  const decoder = new TextDecoder();
  let carry = "";

  try {
    while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch {
        throw new Error("连接中断，未能完整接收模型回复，请重试。");
      }
      const { done, value } = read;
      if (done) break;

      carry += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseDataLines(carry);
      carry = rest;

      for (const raw of events) {
        if (raw === "[DONE]") return;

        let chunk: ZhipuStreamChunk;
        try {
          chunk = JSON.parse(raw) as ZhipuStreamChunk;
        } catch {
          continue;
        }

        if (chunk.error?.message) {
          const code = chunk.error.code ? `（${chunk.error.code}）` : "";
          throw new Error(`模型返回错误${code}：${chunk.error.message}`);
        }

        const text = extractDeltaText(chunk);
        if (text) yield text;
      }
    }

    if (carry.trim()) {
      const { events } = parseSseDataLines(carry + "\n");
      for (const raw of events) {
        if (raw === "[DONE]") return;
        try {
          const chunk = JSON.parse(raw) as ZhipuStreamChunk;
          const text = extractDeltaText(chunk);
          if (text) yield text;
        } catch {
          /* ignore trailing garbage */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
