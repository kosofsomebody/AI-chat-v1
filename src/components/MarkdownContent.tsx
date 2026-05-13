import type { Components } from "react-markdown";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

type MarkdownContentProps = {
  content: string;
  className?: string;
  /** 用户气泡内联代码用较深底纹，避免与绿色气泡冲突 */
  tone?: "assistant" | "user";
};

/** 常见语言别名 → Prism 支持的语言 id */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  python: "python",
  python3: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  sh: "bash",
  shell: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  json: "json",
  jsonc: "json",
  html: "markup",
  xml: "markup",
  vue: "markup",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  kt: "kotlin",
  kotlin: "kotlin",
  kts: "kotlin",
  swift: "swift",
  java: "java",
  csharp: "csharp",
  cs: "csharp",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  c: "c",
  toml: "toml",
  dockerfile: "docker",
  docker: "docker",
  graphql: "graphql",
  gql: "graphql",
};

function normalizePrismLanguage(raw: string | undefined): string {
  if (!raw?.trim()) return "text";
  const key = raw.trim().toLowerCase();
  return LANGUAGE_ALIASES[key] ?? key;
}

const markdownComponents = (
  tone: "assistant" | "user",
): Components => ({
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className ?? "");
    const inline = !match && !text.includes("\n");

    const inlineCodeClass =
      tone === "user"
        ? "rounded bg-black/15 px-1 py-0.5 font-mono text-sm text-black"
        : "rounded bg-slate-200 px-1 py-0.5 font-mono text-sm";

    if (inline) {
      return <code className={inlineCodeClass}>{children}</code>;
    }

    const language = normalizePrismLanguage(match?.[1]);

    return (
      <div className="my-1 overflow-x-auto rounded-lg">
        <SyntaxHighlighter
          language={language}
          style={oneDark}
          PreTag="div"
          showLineNumbers={false}
          wrapLongLines
          customStyle={{
            margin: 0,
            borderRadius: "0.5rem",
            fontSize: "0.8125rem",
            padding: "0.75rem 0.85rem",
          }}
          codeTagProps={{
            style: {
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            },
          }}
        >
          {text}
        </SyntaxHighlighter>
      </div>
    );
  },
});

export function MarkdownContent({
  content,
  className,
  tone = "assistant",
}: MarkdownContentProps) {
  const components = useMemo(() => markdownComponents(tone), [tone]);
  return (
    <div className={className}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
}
