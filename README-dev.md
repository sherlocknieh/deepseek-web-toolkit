# DeepSeek 工具箱（开发目录）

源码在 `src/main.js`，用 [vite-plugin-monkey](https://vite-plugin-monkey.pages.dev/) 调试和构建。一个脚本包含四块功能：

- **会话目录**：把置顶区里名称带 `/` 的会话原地折叠成目录
- **KaTeX 复制修正**：注入官方 copy-tex，复制公式得到 LaTeX 源码（`src/katex-copy.js`）
- **消息导航**：DeepSeek 用原生导航（仅补窄屏显示），其他站点用 `src/message-nav.js` 的通用实现
- **折叠思考**：`src/think-collapse.js` 默认收起已完成的思考块

## 会话目录要点

- 只作用于置顶区；按标题里的 `/` 建树，如「工作/项目A/讨论」→ 工作 → 项目A
- 不复制会话节点，只给列表容器加 `display:flex`，用 `order` 原地重排并插入目录行，保留选中态和“更多”菜单
- 叶子只显示末段，完整路径存在 `data-dscf-full-title`；解析、置顶、拖动都用完整路径
- 目录优先排序：先子目录后叶子，按名称（中文拼音、数字大小）
- 支持新建空目录（内存占位，刷新消失）、行内重命名、拖动整理；未置顶会话改名成路径或拖入目录时自动置顶
- 应用改名输入框打开时暂停重排，保存后自动补回目录前缀

## 消息导航要点

- DeepSeek 自带右侧导航，被 `@media not all and (min-width: 768px)` 隐藏且需悬停才展开；脚本在 `src/styles.js` 里覆盖成全程常显，并给消息列表补右内边距
- 前端在「宽度 ≤1200px 且侧栏展开」时直接不渲染导航（源码条件 `r.length<2 || (u && h)`），CSS 救不回来；`src/native-nav.js` 在 document-start 改写 `matchMedia('(max-width: 1200px)')` 让它恒为 false，该断点只服务导航
- 覆盖规则不设断点：断点两侧的媒体查询区间不重合，缩放跨过 768px 时导航会先消失再出现
- 右内边距用 `max(应用居中留白, 下限)`，下限在 768px 处随列表外边距从 44px 收到 20px 同步从 14px 提到 38px，右侧总留白全程 58px，不会突然变宽
- 其他站点由 `src/message-nav.js` 启动：只依赖 DOM，按 `SITE_ADAPTERS` 里各自的适配项识别消息块、角色、正文范围和滚动容器；未适配站点才退回 `[data-message-author-role]`、`user-query`、`model-response`、`message-content`、`article` 这组通用标记
- 各站点选择器：ChatGPT `[data-message-author-role]` + `main`；Gemini `user-query, model-response`（正文取 `div.query-content` / `message-content`）+ `infinite-scroller`；Grok `div[id^='response-']`（用户消息带 `items-end`，正文取 `.response-content-markdown`）+ `main`
- 命中元素若被其他命中元素包含会被丢掉，避免容器和子元素重复计数；角色优先读标记，读不到时按提问/回答交替推断
- 形态照搬 DeepSeek 原生导航（尺寸取自其线上样式）：fixed 右侧 16px、垂直居中、高 300px，收起 34px、悬停展开 240px；条目 30px 高，横线 8×2，当前项放大 1.5 倍并变品牌色；展开后列表可滚动并带上下同色渐隐；768px 以下整体隐藏
- 横线高亮跟随滚动（悬停展开时自动滚进可见范围），跳转后短暂高亮目标消息
- 消息少于 3 条时整体隐藏；SPA 切会话靠 700ms 地址栏轮询重新识别

## 安装与调试

```shell
npm install
npm run hooks   # 指向 .githooks，启用提交前自动升版本+构建
npm run dev
```

把终端输出的 `http://localhost:5173/__vite-plugin-monkey.install.user.js` 装进油猴，打开 https://chat.deepseek.com ，改 `src/main.js` 保存即热更新。

注意：页面 CSP 会拦截 localhost 脚本（需 Disable-CSP 类扩展）；Chrome 142+ 需允许 Local network access。

## 版本号与发布

版本号在 `vite.config.js` 的 `userscript.version`，由脚本按本地时间生成 `YYYY.MM.DD.HHmm`，**不要手改，也不要手改 `dist`**。

- 提交前钩子 `.githooks/pre-commit` → `scripts/bump-and-build.mjs`：升版本 → 构建 → 核对产物 `@version`，失败还原配置并中断提交
- `npm run release "feat: …"`：升版本 → 构建 → commit → tag；`--push` 推送，`--dry-run` 只预览版本号
- `npm run build`：只构建，不改版本号

## Firefox

装构建版 `dist/deepseek-web-toolkit.user.js`；带 `server:` 前缀的调试版依赖 Vite 服务和 CSP 放行。控制台出现 `[DeepSeek 工具箱] 脚本已加载` 和 `已初始化，会话数 N` 即生效。

## 结构

- `src/*.js`：按职责拆分，模块图与改动路径见 [AGENTS.md](./AGENTS.md)
- `vite.config.js`：userscript 元数据与构建输出
- `scripts/bump-and-build.mjs` / `scripts/release.mjs` / `.githooks/pre-commit`：版本号与发布
