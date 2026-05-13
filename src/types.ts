/** 对话中的一条消息（与 PRD / 技术设计一致） */
export type MessageRole = "user" | "assistant";

export interface Message {
  role: MessageRole;
  content: string;
  timestamp: number;
}
