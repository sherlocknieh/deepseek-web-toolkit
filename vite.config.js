import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

// 开发：npm run dev 后把终端里的 dev 版 userscript 装进油猴，改代码自动热更新
// 构建：npm run build 直接覆盖 dist 下的发布文件，保持 README 安装链接不变
// 版本号：由 scripts/bump-and-build.mjs 按日期时间写入，不要手改
export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.js',
      userscript: {
        name: 'DeepSeek 网页端工具箱 - LaTeX 公式复制 & 会话文件夹 & 消息导航 & 折叠思考',
        namespace: 'http://tampermonkey.net/',
        version: '2026.11.12.1320',
        description: '增强 DeepSeek 网页端使用体验: 会话文件夹 + 消息导航 + KaTeX 公式复制修正 + 默认折叠思考。',
        author: 'sherlocknieh',
        match: [
            'https://chat.deepseek.com/*',
            'https://chatgpt.com/*',
            'https://chat.openai.com/*',
            'https://gemini.google.com/*',
            'https://grok.com/*'
        ],
        icon: 'https://www.deepseek.com/favicon.ico',
        license: 'MIT',
        downloadURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        updateURL: 'https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js',
        grant: ['GM_setValue', 'GM_getValue'],
        // 导航断点必须在应用初始化前改写，否则导航已被卸载
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
