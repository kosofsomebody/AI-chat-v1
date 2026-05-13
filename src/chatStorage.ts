import type { Message, MessageRole } from "./types";

const STORAGE_KEY = "ai-chat-assistant:messages";

function isMessageRole(v: unknown): v is MessageRole {
  return v === "user" || v === "assistant";
}

function isMessageRecord(v: unknown): v is Message {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    isMessageRole(o.role) &&
    typeof o.content === "string" &&
    typeof o.timestamp === "number" &&
    Number.isFinite(o.timestamp)
  );
}

export function loadChatMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Message[] = [];
    for (const item of parsed) {
      // 同时过滤空内容（防止旧脏数据或中断流式时的占位消息进入对话历史）
      if (isMessageRecord(item) && item.content.trim() !== "") out.push({ ...item });
    }
    return out;
  } catch {
    return [];
  }
}

export function saveChatMessages(messages: Message[]): void {
  try {
    // 过滤占位空消息（流式输出中断时 content === ""），避免下次加载时触发 API 400
    const toSave = messages.filter((m) => m.content.trim() !== "");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {
    /* 配额满或隐私模式等，静默失败 */
  }
}

export function clearChatMessagesStorage(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
