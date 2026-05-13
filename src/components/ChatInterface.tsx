import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { streamZhipuChat } from "../api";
import { formatChatApiError } from "../apiErrors";
import {
  clearChatMessagesStorage,
  loadChatMessages,
  saveChatMessages,
} from "../chatStorage";
import type { Message } from "../types";
import { MarkdownContent } from "./MarkdownContent";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 每帧从流式缓冲区多显示几个字符（1 更接近「逐字」） */
const CHARS_PER_FRAME = 1;

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>(() => loadChatMessages());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestGenRef = useRef(0);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  /** 智谱流式已接收的完整助手文本（缓冲区） */
  const assistantTargetRef = useRef("");
  /** 已「打字」展示到界面上的长度（≤ assistantTargetRef） */
  const assistantDisplayedLenRef = useRef(0);
  const streamFinishedRef = useRef(false);
  const pumpRafRef = useRef<number>(0);

  /** 每次对话内容更新后始终滚到底部 */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /** 持久化到 LocalStorage —— PRD 要求刷新页面不丢失对话 */
  useEffect(() => {
    saveChatMessages(messages);
  }, [messages]);

  const stopPump = useCallback(() => {
    if (pumpRafRef.current) {
      cancelAnimationFrame(pumpRafRef.current);
      pumpRafRef.current = 0;
    }
  }, []);

  const schedulePump = useCallback(
    (gen: number) => {
      if (pumpRafRef.current) return;
      const pump = () => {
        if (gen !== requestGenRef.current) {
          pumpRafRef.current = 0;
          return;
        }

        const target = assistantTargetRef.current;
        let len = assistantDisplayedLenRef.current;

        if (len < target.length) {
          len = Math.min(
            target.length,
            len + CHARS_PER_FRAME,
          );
          assistantDisplayedLenRef.current = len;
          const slice = target.slice(0, len);
          setMessages((prev) => {
            if (gen !== requestGenRef.current) return prev;
            if (prev.length === 0) return prev;
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role !== "assistant") return prev;
            next[next.length - 1] = { ...last, content: slice };
            return next;
          });
          pumpRafRef.current = requestAnimationFrame(pump);
          return;
        }

        if (!streamFinishedRef.current) {
          pumpRafRef.current = requestAnimationFrame(pump);
          return;
        }

        pumpRafRef.current = 0;
        if (gen === requestGenRef.current) {
          setLoading(false);
          abortRef.current = null;
        }
      };
      pumpRafRef.current = requestAnimationFrame(pump);
    },
    [],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    stopPump();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    requestGenRef.current += 1;
    const gen = requestGenRef.current;

    setError(null);
    setInput("");
    setLoading(true);

    const now = Date.now();
    const userMsg: Message = { role: "user", content: text, timestamp: now };
    const assistantMsg: Message = {
      role: "assistant",
      content: "",
      timestamp: now + 1,
    };

    assistantTargetRef.current = "";
    assistantDisplayedLenRef.current = 0;
    streamFinishedRef.current = false;

    // 直接用当前 messages 闭包构造 payload，避免依赖 updater 内部赋值的时序隐患
    const apiPayload: Message[] = [...messages, userMsg];
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    schedulePump(gen);

    try {
      for await (const piece of streamZhipuChat(apiPayload, {
        signal: controller.signal,
      })) {
        if (gen !== requestGenRef.current) break;
        assistantTargetRef.current += piece;
      }

      if (gen === requestGenRef.current) {
        streamFinishedRef.current = true;
        schedulePump(gen);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        stopPump();
        if (gen === requestGenRef.current) {
          setLoading(false);
          abortRef.current = null;
        }
        return;
      }
      if (gen !== requestGenRef.current) return;

      stopPump();
      streamFinishedRef.current = true;

      const text = formatChatApiError(e);
      if (text) setError(text);
      setMessages((prev) => {
        if (gen !== requestGenRef.current) return prev;
        if (prev.length < 2) return prev;
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          next.pop();
        }
        return next;
      });
      setLoading(false);
      abortRef.current = null;
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  useEffect(() => () => stopPump(), [stopPump]);

  const handleClearChat = useCallback(() => {
    if (messages.length === 0) return;
    const ok = window.confirm("确定要清空所有对话吗？此操作无法撤销。");
    if (!ok) return;
    abortRef.current?.abort();
    abortRef.current = null;
    stopPump();
    requestGenRef.current += 1;
    streamFinishedRef.current = true;
    assistantTargetRef.current = "";
    assistantDisplayedLenRef.current = 0;
    setMessages([]);
    clearChatMessagesStorage();
    setError(null);
    setLoading(false);
    setInput("");
  }, [messages.length, stopPump]);

  const copyAssistantReply = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
      } catch {
        setError("无法复制到剪贴板：请检查浏览器权限，或手动选中文字复制。");
      }
    },
    [],
  );

  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-lg flex-col bg-[#ededed] text-[#111]">
      <header className="z-10 flex shrink-0 items-center justify-between gap-2 border-b border-black/10 bg-[#ededed] px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <span aria-hidden className="w-14" />
        <h1 className="text-[17px] font-semibold tracking-tight">AI 聊天助手</h1>
        <button
          type="button"
          onClick={handleClearChat}
          disabled={messages.length === 0}
          className="w-14 shrink-0 rounded-md py-1 text-sm font-medium text-[#576b95] hover:bg-black/[0.06] active:bg-black/[0.08] disabled:cursor-not-allowed disabled:text-black/25 disabled:hover:bg-transparent"
          aria-label="清空对话"
        >
          清空
        </button>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
      >
        <div className="flex flex-col gap-4">
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-black/40">
              在下方输入消息，按 Enter 发送（Shift+Enter 换行）
            </p>
          )}
          {messages.map((m, i) => {
            const isUser = m.role === "user";
            const showThinking =
              loading &&
              m.role === "assistant" &&
              i === messages.length - 1 &&
              m.content === "";

            return (
              <div
                key={`${m.timestamp}-${i}`}
                className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[min(85%,20rem)] shrink-0 ${
                    isUser ? "items-end" : "items-start"
                  } flex flex-col gap-1`}
                >
                  <div
                    className={
                      isUser
                        ? "rounded-2xl rounded-tr-md bg-[#95ec69] px-3 py-2 text-[15px] leading-relaxed text-black shadow-sm"
                        : "rounded-2xl rounded-tl-md border border-black/5 bg-white px-3 py-2 text-[15px] leading-relaxed text-black shadow-sm"
                    }
                  >
                    {isUser ? (
                      <MarkdownContent
                        content={m.content}
                        tone="user"
                        className="markdown-bubble markdown-bubble-user"
                      />
                    ) : (
                      <>
                        <MarkdownContent
                          content={m.content}
                          tone="assistant"
                          className="markdown-bubble markdown-bubble-assistant"
                        />
                        {showThinking && (
                          <span className="mt-1 inline-block text-xs text-black/45">
                            思考中...
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div
                    className={`flex items-center gap-2 px-1 ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <span className="text-[11px] text-black/35">
                      {formatTime(m.timestamp)}
                    </span>
                    {!isUser && m.content.trim().length > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          void copyAssistantReply(
                            `${m.timestamp}-${i}`,
                            m.content,
                          )
                        }
                        className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[#576b95] hover:bg-black/[0.06] active:bg-black/[0.08]"
                      >
                        {copiedKey === `${m.timestamp}-${i}`
                          ? "已复制"
                          : "复制"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {error && (
        <div
          className="shrink-0 border-t border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          role="alert"
        >
          <div className="mx-auto flex max-w-lg items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-red-900">暂时无法继续对话</p>
              <p className="mt-1 leading-relaxed text-red-800/95">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="shrink-0 rounded-md px-2 py-1 text-base leading-none text-red-700/80 hover:bg-red-100 hover:text-red-900"
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-black/10 bg-[#f7f7f7] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={loading ? "思考中..." : "输入消息"}
            disabled={loading}
            rows={3}
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-[15px] leading-snug text-black shadow-inner outline-none placeholder:text-black/35 focus:border-[#07c160]/50 disabled:bg-black/[0.04] disabled:text-black/40"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="mb-0.5 shrink-0 rounded-lg bg-[#07c160] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-[#06ad56] disabled:cursor-not-allowed disabled:bg-black/20 disabled:text-white/80"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
