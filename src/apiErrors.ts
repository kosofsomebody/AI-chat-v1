/** 将智谱 / 网络相关异常转换为用户可读的中文说明 */

export function friendlyHttpStatus(status: number, detail: string): string {
  const trimmed = detail.trim();
  const shortDetail =
    trimmed.length > 0 && trimmed.length < 160 ? trimmed : "";

  switch (status) {
    case 400:
      return shortDetail
        ? `请求参数有问题：${shortDetail}`
        : "请求参数有误，请换种说法或缩短上下文后再试。";
    case 401:
      return "API Key 无效或未授权：请检查 .env 中的 VITE_ZHIPU_API_KEY 是否正确、是否已开通对应模型。";
    case 403:
      return "没有权限访问该接口：请确认账户状态、余额或模型权限是否正常。";
    case 404:
      return "请求的接口或模型不存在：请检查 VITE_ZHIPU_API_BASE 与 VITE_ZHIPU_MODEL 配置。";
    case 408:
      return "请求超时：请检查网络后重试，或稍后再试。";
    case 429:
      return "请求过于频繁：请稍等片刻再发送。";
    default:
      if (status >= 500) {
        return "智谱服务暂时不可用，请稍后再试。";
      }
      return shortDetail
        ? `请求失败（${status}）：${shortDetail}`
        : `请求失败（错误码 ${status}），请稍后重试。`;
  }
}

export function formatChatApiError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "";
  }

  if (error instanceof TypeError) {
    return "网络连接异常，请检查网络或代理设置后重试。";
  }

  if (!(error instanceof Error)) {
    return "发生未知错误，请稍后重试。";
  }

  const msg = error.message;

  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    return "网络连接异常，请检查网络或代理设置后重试。";
  }

  if (msg.includes("VITE_ZHIPU_API_KEY")) {
    return msg;
  }

  if (msg.length > 220) {
    return "服务返回了异常信息，请稍后再试。若持续出现，可检查模型名称与账户配额。";
  }

  return msg;
}
