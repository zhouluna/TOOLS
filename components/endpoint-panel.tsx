"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { adapterLabel, formatShanghai } from "@/lib/labels";
import type { ModelView } from "@/lib/types";

function exampleBody(model: ModelView): string {
  return JSON.stringify(
    {
      model: model.endpoint?.nvidiaModelId ?? "模型详情中确认的模型ID",
      messages: [{ role: "user", content: "你好" }],
      stream: true,
    },
    null,
    2,
  );
}

export function EndpointPanel({ model }: { model: ModelView }) {
  const [copied, setCopied] = useState("");
  const endpoint = model.endpoint;
  const url = endpoint?.url ?? "";

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  const curl = url
    ? `curl ${url} \\\n  -H "Authorization: Bearer $NVIDIA_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${exampleBody(model)}'`
    : "";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-6 md:px-8">
      <div>
        <h2 className="text-2xl font-medium tracking-tight">{model.displayName}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{model.summary}</p>
      </div>
      <dl className="grid gap-px overflow-hidden rounded-md border bg-border sm:grid-cols-2">
        <Fact label="请求方法" value={endpoint?.method ?? "待确认"} />
        <Fact label="模型 ID" value={endpoint?.nvidiaModelId ?? "待确认"} mono />
        <Fact label="认证" value="Authorization: Bearer API Key" />
        <Fact label="请求类型" value={endpoint ? adapterLabel(endpoint.adapter) : "未确认"} />
        <Fact label="确认状态" value={endpoint?.confirmStatus === "confirmed" ? "已确认" : "待确认"} />
        <Fact label="信息更新" value={formatShanghai(endpoint?.confirmedAt ?? model.lastSeenAt)} />
      </dl>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">POST 地址</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!url}
            onClick={() => copy("url", url)}
          >
            {copied === "url" ? "已复制" : "复制地址"}
          </Button>
        </div>
        <p className="overflow-x-auto rounded-md bg-[#1c2838] px-3 py-2 font-mono text-xs leading-6 text-[#d7e4f2]">
          {url || "页面上没有确认到调用地址"}
        </p>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">已确认参数</h3>
          <Button type="button" variant="outline" size="sm" onClick={() => copy("body", exampleBody(model))}>
            {copied === "body" ? "已复制" : "复制示例"}
          </Button>
        </div>
        {endpoint?.params.length ? (
          <p className="text-sm text-muted-foreground">{endpoint.params.join("、")}</p>
        ) : (
          <p className="text-sm text-muted-foreground">参数尚未从官方文档确认，调用前请对照官网。</p>
        )}
        <pre className="mt-3 overflow-x-auto rounded-md bg-[#1c2838] p-3 font-mono text-xs leading-6 text-[#d7e4f2]">
          {exampleBody(model)}
        </pre>
        {curl ? (
          <Button className="mt-3" type="button" variant="outline" size="sm" onClick={() => copy("curl", curl)}>
            {copied === "curl" ? "已复制" : "复制 curl"}
          </Button>
        ) : null}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          示例里的密钥是占位符 $NVIDIA_API_KEY，不会写入真实 Key。
        </p>
      </div>
      <p className="text-sm">
        <a className="text-primary underline-offset-4 hover:underline" href={model.pageUrl} target="_blank" rel="noreferrer">
          打开官网模型页
        </a>
        <span className="mx-2 text-muted-foreground">·</span>
        <span className="text-muted-foreground">{model.freeSource}</span>
      </p>
    </div>
  );
}

function Fact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card px-3 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 text-sm break-all ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
