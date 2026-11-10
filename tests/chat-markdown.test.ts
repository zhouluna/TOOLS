import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatMarkdown } from "../components/chat-markdown";

function render(content: string, tone: "user" | "assistant" = "assistant"): string {
  return renderToStaticMarkup(createElement(ChatMarkdown, { content, tone }));
}

test("renders common markdown instead of raw syntax", () => {
  const html = render(
    ["### 标题", "", "这是 **粗体** 和 *斜体*。", "", "- 第一项", "- 第二项", "", "1. 有序", "", "看 [文档](https://example.com/docs)。", "", "行内 `const n = 1`。", "", "```ts", "const answer = 42;", "```"].join("\n"),
  );

  assert.match(html, /<h3[^>]*>标题<\/h3>/);
  assert.match(html, /<strong[^>]*>粗体<\/strong>/);
  assert.match(html, /<em[^>]*>斜体<\/em>/);
  assert.match(html, /<ul[^>]*>[\s\S]*<li[^>]*>第一项<\/li>[\s\S]*<li[^>]*>第二项<\/li>/);
  assert.match(html, /<ol[^>]*>[\s\S]*<li[^>]*>有序<\/li>/);
  assert.match(html, /<a [^>]*href="https:\/\/example\.com\/docs"/);
  assert.match(html, /<code[^>]*>const n = 1<\/code>/);
  assert.match(html, /<pre[^>]*>[\s\S]*<code[^>]*>const answer = 42;[\s\S]*<\/code>[\s\S]*<\/pre>/);
  assert.equal(html.includes("###"), false);
  assert.equal(html.includes("**"), false);
  assert.equal(html.includes("```"), false);
});

test("keeps single line breaks inside a paragraph", () => {
  const html = render("第一行\n第二行");
  assert.match(html, /第一行<br\s*\/?>\s*第二行|第一行<\/p>\s*<p[^>]*>第二行/);
});

test("renders markdown in both user and assistant bubbles", () => {
  for (const tone of ["user", "assistant"] as const) {
    const html = render("**你好**", tone);
    assert.match(html, /<strong[^>]*>你好<\/strong>/);
    assert.match(html, new RegExp(`data-tone="${tone}"`));
  }
});

test("does not execute or inject html from untrusted message text", () => {
  const html = render(
    [
      '<script>alert("xss")</script>',
      '<img src=x onerror="alert(1)">',
      '<a href="javascript:alert(1)">点我</a>',
      "[坏链接](javascript:alert(1))",
      "[数据链接](data:text/html,<script>alert(1)</script>)",
      "[协议相对](//evil.example/phish)",
    ].join("\n\n"),
  );

  assert.equal(/<script[\s>]/i.test(html), false);
  assert.equal(/<img[\s>]/i.test(html), false);
  assert.equal(/href\s*=\s*["']\s*javascript:/i.test(html), false);
  assert.equal(/href\s*=\s*["']\s*data:/i.test(html), false);
  assert.equal(/href\s*=\s*["']\s*\/\//i.test(html), false);
  assert.equal(/onerror\s*=\s*["']/i.test(html), false);
  assert.match(html, /&lt;script&gt;|alert\(&quot;xss&quot;\)/);
});

test("opens only http, https, and mailto links", () => {
  const html = render("[信](mailto:a@example.com) [站](https://example.com)");
  assert.match(html, /href="mailto:a@example.com"/);
  assert.match(html, /href="https:\/\/example\.com\/"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /target="_blank"/);
});
