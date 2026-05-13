import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/** 浏览器直连智谱域名常被 CORS 拦截；开发/预览时走同源代理转发 */
const zhipuProxy = {
  "/api/zhipu": {
    target: "https://open.bigmodel.cn/api/paas/v4",
    changeOrigin: true,
    secure: true,
    rewrite: (path: string) => path.replace(/^\/api\/zhipu/, ""),
  },
} as const;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { proxy: zhipuProxy },
  preview: { proxy: zhipuProxy },
});
