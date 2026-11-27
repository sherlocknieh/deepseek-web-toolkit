import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { devBundle, devCspNonce } from './.dev/dev-kit.mjs';

// 开发：nub run dev 后把终端里的 dev 版 userscript 装进油猴，改代码自动热更新
// 构建：nub run build 直接覆盖 dist 下的发布文件，保持 README 安装链接不变
// 版本号：由 .dev/bump-and-build.mjs 按日期时间写入，不要手改
// 开发载入器（CSP 站点的 nonce / blob 兜底）见 .dev/dev-kit.mjs
export default defineConfig({
  server: {
    open: true,
  },
  plugins: [
    devCspNonce(),
    devBundle(),
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'DeepSeek 修复+优化',
        namespace: 'http://tampermonkey.net/',
        version: '2026.11.27.2338',
        description: '优化 DeepSeek 网页端使用体验: KaTeX 公式复制修正 + 会话文件夹 + 消息导航 + 默认折叠思考。',
        author: 'sherlocknieh',
        match: [
            'https://chat.deepseek.com/*',
            'https://chatgpt.com/*',
            'https://chat.openai.com/*',
            'https://gemini.google.com/*',
            'https://grok.com/*',
            'https://sichang.xyz/*',
            'https://*.sichang.xyz/*',
            'https://venice.ai/*',
            'https://*.venice.ai/*'
        ],
        icon: 'https://www.deepseek.com/favicon.ico',
        license: 'MIT',
        downloadURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        updateURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        grant: ['GM_setValue', 'GM_getValue'],
        'run-at': 'document-start',
      },
      build: {
        fileName: 'deepseek-web-toolkit.user.js',
        metaFileName: false,
      },
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
  },
});
