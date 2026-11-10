import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export type ChatMarkdownTone = "user" | "assistant";
export type ChatMarkdownSurface = "light" | "dark";

type ChatMarkdownProps = {
  content: string;
  tone: ChatMarkdownTone;
  surface?: ChatMarkdownSurface;
  className?: string;
};

const remarkPlugins = [remarkGfm, remarkBreaks];

const allowedElements = [
  "a",
  "blockquote",
  "br",
  "code",
  "del",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "li",
  "ol",
  "p",
  "pre",
  "section",
  "strong",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "ul",
];

function safeChatUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /[\u0000-\u001F\u007F]/.test(trimmed)) return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") {
    return "";
  }
  return parsed.href;
}

function surfaceClasses(surface: ChatMarkdownSurface): { link: string; code: string; pre: string } {
  switch (surface) {
    case "dark":
      return {
        link: "break-all text-[#d6e4ff] underline decoration-white/40 underline-offset-2",
        code: "rounded bg-white/15 px-1 py-0.5 font-mono text-[0.92em]",
        pre: "my-2 max-w-full overflow-x-auto rounded-md bg-black/30 px-3 py-2 font-mono text-[0.92em] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit",
      };
    case "light":
      return {
        link: "break-all text-[#1f4fd8] underline decoration-[#1f4fd8]/40 underline-offset-2",
        code: "rounded border border-[#d5e0e8] bg-white px-1 py-0.5 font-mono text-[0.92em]",
        pre: "my-2 max-w-full overflow-x-auto rounded-md border border-[#d5e0e8] bg-[#f7fafc] px-3 py-2 font-mono text-[0.92em] leading-5 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-inherit",
      };
    default: {
      const unreachable: never = surface;
      return unreachable;
    }
  }
}

function markdownComponents(surface: ChatMarkdownSurface): Components {
  const classes = surfaceClasses(surface);
  return {
    a: ({ href, children }) => {
      const safeHref = typeof href === "string" ? safeChatUrl(href) : "";
      if (!safeHref) return <span>{children}</span>;
      return (
        <a href={safeHref} target="_blank" rel="noopener noreferrer" className={classes.link}>
          {children}
        </a>
      );
    },
    blockquote: ({ children }) => (
      <blockquote className="my-2 border-l-2 border-current/30 pl-3 opacity-80">{children}</blockquote>
    ),
    code: ({ children }) => <code className={classes.code}>{children}</code>,
    del: ({ children }) => <del className="opacity-70">{children}</del>,
    h1: ({ children }) => <h1 className="mt-2 mb-1 text-base font-semibold leading-6 first:mt-0">{children}</h1>,
    h2: ({ children }) => <h2 className="mt-2 mb-1 text-[0.95rem] font-semibold leading-6 first:mt-0">{children}</h2>,
    h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold leading-6 first:mt-0">{children}</h3>,
    h4: ({ children }) => <h4 className="mt-2 mb-1 text-sm font-semibold leading-6 first:mt-0">{children}</h4>,
    h5: ({ children }) => <h5 className="mt-2 mb-1 text-sm font-medium leading-6 first:mt-0">{children}</h5>,
    h6: ({ children }) => <h6 className="mt-2 mb-1 text-sm font-medium leading-6 first:mt-0">{children}</h6>,
    hr: () => <hr className="my-3 border-current/20" />,
    img: ({ alt, src }) => {
      const safeSrc = typeof src === "string" ? safeChatUrl(src) : "";
      const label = alt || safeSrc;
      if (!safeSrc) return label ? <span>{label}</span> : null;
      return (
        <a href={safeSrc} target="_blank" rel="noopener noreferrer" className={classes.link}>
          {label}
        </a>
      );
    },
    input: ({ checked, type }) =>
      type === "checkbox" ? (
        <input type="checkbox" checked={Boolean(checked)} disabled readOnly className="mr-1 align-middle" />
      ) : null,
    li: ({ children }) => <li className="pl-0.5 [&>p]:my-0">{children}</li>,
    ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ol>,
    p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
    pre: ({ children }) => <pre className={classes.pre}>{children}</pre>,
    section: ({ children }) => (
      <section className="mt-2 border-t border-current/15 pt-2 text-[0.92em]">{children}</section>
    ),
    sup: ({ children }) => <sup className="text-[0.75em]">{children}</sup>,
    table: ({ children }) => (
      <div className="my-2 max-w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-[0.92em]">{children}</table>
      </div>
    ),
    td: ({ children }) => <td className="border border-current/20 px-2 py-1 align-top">{children}</td>,
    th: ({ children }) => (
      <th className="border border-current/20 px-2 py-1 align-top font-semibold">{children}</th>
    ),
    ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5 first:mt-0 last:mb-0">{children}</ul>,
  };
}

const componentsBySurface: Record<ChatMarkdownSurface, Components> = {
  dark: markdownComponents("dark"),
  light: markdownComponents("light"),
};

export function ChatMarkdown({ content, tone, surface = "light", className }: ChatMarkdownProps) {
  if (!content) return null;
  return (
    <div data-tone={tone} className={cn("min-w-0 max-w-full break-words", className)}>
      <Markdown
        allowedElements={allowedElements}
        components={componentsBySurface[surface]}
        remarkPlugins={remarkPlugins}
        urlTransform={safeChatUrl}
      >
        {content}
      </Markdown>
    </div>
  );
}
