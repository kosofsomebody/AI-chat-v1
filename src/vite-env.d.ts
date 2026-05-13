/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZHIPU_API_KEY: string;
  /** 直连智谱根 URL；不设则请求走同源 `/api/zhipu`，由 Vite 开发/预览代理转发（避免 CORS） */
  readonly VITE_ZHIPU_API_BASE?: string;
  /** 可选，默认 glm-4-flash */
  readonly VITE_ZHIPU_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
