export type ApiErrorCode =
  | "auth"
  | "forbidden"
  | "rate_limit"
  | "unavailable"
  | "bad_request"
  | "network"
  | "offline"
  | "not_adapted"
  | "unconfirmed";

export type ApiErrorBody = {
  code: ApiErrorCode;
  message: string;
  retryAfterSeconds?: number;
};

export type NetworkReason = "timeout" | "connect" | "dns" | "tls" | "reset" | "unknown";

function errorCodes(error: unknown): { codes: Set<string>; message: string } {
  const codes = new Set<string>();
  let message = "";
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const item = current as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown };
    if (typeof item.name === "string") codes.add(item.name);
    if (typeof item.code === "string") codes.add(item.code);
    if (!message && typeof item.message === "string") message = item.message;
    current = item.cause;
  }
  return { codes, message };
}

// Only return known diagnostic categories: never expose raw errors, URLs or headers.
export function networkReason(error: unknown): NetworkReason {
  const { codes, message } = errorCodes(error);
  if (codes.has("UND_ERR_CONNECT_TIMEOUT")) return "connect";
  if (codes.has("TimeoutError") || /aborted due to timeout/i.test(message)) return "timeout";
  if (codes.has("ENOTFOUND") || codes.has("EAI_AGAIN")) return "dns";
  if ([...codes].some((code) => /^(CERT_|ERR_TLS_|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)/.test(code))) {
    return "tls";
  }
  if (codes.has("ECONNREFUSED") || codes.has("ECONNRESET") || codes.has("ENETUNREACH")) return "reset";
  return "unknown";
}

export function classifyNetworkError(error: unknown): string {
  const reason = networkReason(error);
  switch (reason) {
    case "connect":
      return "连接 NVIDIA 超时，请检查网络或代理设置。";
    case "timeout":
      return "等待 NVIDIA 响应超时，可能是模型繁忙；可以换一个模型后重试。";
    case "dns":
      return "无法解析 NVIDIA 域名，请检查 DNS 和网络。";
    case "tls":
      return "与 NVIDIA 建立安全连接失败，请检查系统时间、证书或代理设置。";
    case "reset":
      return "连接 NVIDIA 失败或中断，请检查网络或代理设置。";
    case "unknown":
      return "连接 NVIDIA 失败，请检查网络或代理设置后重试。";
    default: {
      const unexpected: never = reason;
      return unexpected;
    }
  }
}

export function classifyUpstream(status: number, retryAfterHeader: string | null): ApiErrorBody {
  const retryAfterSeconds = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;
  const retry =
    retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds
      : undefined;

  if (status === 401) {
    return { code: "auth", message: "认证失败。检查 API Key，或重新输入后再试。" };
  }
  if (status === 403) {
    return {
      code: "forbidden",
      message: "账户可能无权访问这个模型。可以到模型官网确认权限。",
    };
  }
  if (status === 429) {
    const wait = retry ? `建议 ${retry} 秒后再试。` : "请稍后再试。";
    return { code: "rate_limit", message: `请求过多，NVIDIA 正在限流。${wait}`, retryAfterSeconds: retry };
  }
  if (status === 404 || status === 410 || status === 503) {
    return { code: "unavailable", message: "这个模型当前不可用。对话已保留，可以换一个模型或稍后重试。" };
  }
  if (status === 400 || status === 422) {
    return { code: "bad_request", message: "请求参数不被接受。已停止自动重试，可以改参数后再发。" };
  }
  if (status === 408 || status >= 500) {
    return { code: "network", message: "NVIDIA 没有及时返回。输入还在，可以手动重试。" };
  }
  return { code: "network", message: "调用没有完成。输入还在，可以手动重试。" };
}
