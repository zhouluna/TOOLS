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
