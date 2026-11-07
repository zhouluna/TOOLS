import type { Adapter, Category, ModelStatus } from "@/lib/types";

export function categoryLabel(category: Category): string {
  switch (category) {
    case "chat":
      return "聊天";
    case "vision":
      return "视觉";
    case "embedding":
      return "向量化";
    case "rerank":
      return "重排";
    case "speech":
      return "语音";
    case "image":
      return "图片";
    case "other":
      return "其他";
    default: {
      const unexpected: never = category;
      return unexpected;
    }
  }
}

export function statusLabel(status: ModelStatus): string {
  switch (status) {
    case "chat_ready":
      return "可聊天";
    case "pending_adapt":
      return "待适配";
    case "unconfirmed":
      return "待确认";
    case "suspected_offline":
      return "疑似下线";
    case "offline":
      return "已下线";
    default: {
      const unexpected: never = status;
      return unexpected;
    }
  }
}

export function adapterLabel(adapter: Adapter): string {
  switch (adapter) {
    case "openai_chat":
      return "聊天补全";
    case "embedding":
      return "向量化";
    case "rerank":
      return "重排";
    case "other":
      return "专用接口";
    case "unknown":
      return "未确认";
    default: {
      const unexpected: never = adapter;
      return unexpected;
    }
  }
}

export function formatShanghai(iso: string | null | undefined): string {
  if (!iso) return "还没有";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "还没有";
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${formatted} 上海`;
}
