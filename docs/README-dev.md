# DeepSeek 工具箱（开发目录）

源码在 `src/main.js`，用 [vite-plugin-monkey](https://vite-plugin-monkey.pages.dev/) 调试和构建。一个脚本包含四块功能：

- **会话目录**：把置顶区里名称带 `/` 的会话原地折叠成目录
- **KaTeX 复制修正**：注入官方 copy-tex，复制公式得到 LaTeX 源码（`src/katex-copy.js`）
- **消息导航**：所有站点（含 DeepSeek）都用 `src/message-nav.js` 的通用实现，DeepSeek 的原生导航由样式隐藏
- **折叠思考**：`src/think-collapse.js` 默认收起已完成的思考块

## 会话目录要点

- 只作用于置顶区；按标题里的 `/` 建树，如「工作/项目A/讨论」→ 工作 → 项目A
- 不复制会话节点，只给列表容器加 `display:flex`，用 `order` 原地重排并插入目录行，保留选中态和“更多”菜单
- 叶子只显示末段，完整路径存在 `data-dscf-full-title`；解析、置顶、拖动都用完整路径
- 目录优先排序：先子目录后叶子，按名称（中文拼音、数字大小）
- 支持新建空目录（内存占位，刷新消失）、行内重命名、拖动整理；未置顶会话改名成路径或拖入目录时自动置顶
- 应用改名输入框打开时暂停重排，保存后自动补回目录前缀

## 消息导航要点

- DeepSeek 的原生右侧导航（被 `@media not all and (min-width: 768px)` 隐藏、需悬停才展开，且「宽度 ≤1200px 且侧栏展开」时前端干脆不渲染）已由脚本的通用导航完全接替：`src/styles.js` 把它 `display: none`，再由 `src/message-nav.js` 按 DeepSeek 结构识别提问
- 消息区右内边距用 `max(应用居中留白, 下限)`，下限在 768px 处随列表外边距从 44px 收到 20px 同步从 14px 提到 38px，右侧总留白全程 58px，通用导航不会压住正文
- 其他站点同样由 `src/message-nav.js` 启动：只依赖 DOM，按 `SITE_ADAPTERS` 里各自的适配项识别消息块、角色、正文范围和滚动容器；未适配站点才退回 `[data-message-author-role]`、`user-query`、`model-response`、`message-content`、`article` 这组通用标记
- 各站点选择器：ChatGPT `[data-message-author-role]` / `[data-chatgpt-search-unit-key]` + `main`；Gemini `user-query, model-response`（正文取 `div.query-content` / `message-content`）+ `infinite-scroller`；Grok `div[id^='response-']`（用户消息靠 `[data-testid=user-message]` 判定，正文取 `.response-content-markdown`）+ `main`；DeepSeek `[data-virtual-list-item-key]`（回答里有 `.ds-markdown`）+ `.ds-scroll-area`；思畅 AI `.chat-message-copy`（用户）/ `.chat-message-markdown`（回答）+ `[data-slot=scroll-area-viewport]`；Venice agentic 页 `[role=group]` / `.assistant`、经典聊天页 `[data-message-id]`，滚动容器按最近的滚动祖先现找
- 适配项的 `scroller` 既可写选择器，也可写成 `(block) => element` 的函数：Venice 经典聊天的滚动容器只带内联样式、没有类名，只能从消息块往上找最近的 `overflow-y: auto/scroll` 祖先，且不要求已经溢出，短会话也要认下容器
- 命中元素若被其他命中元素包含会被丢掉，避免容器和子元素重复计数；角色优先读标记，读不到时按提问/回答交替推断；导航只列用户提问，回答不进列表
- 每条提问按消息块序号取紧随其后的回答块（`replyKey` / `replyEl` / `replyText`），回答晚于提问出现时签名会变化并重画条目，回答按钮随之启用；行本身是容器，内部两个按钮分别跳当前预览和切换预览
- 预览区叠着提问与回答两段文字，当前侧靠 `flex-grow` 从 0 宽度展开、另一侧同时收缩；左边图标标明当前预览的类型（圆圈问号 / 气泡），右侧按钮显示另一侧的图标，点击后切换预览并跳到对应消息。回答流式输出时签名不变，只把最新正文原地写回，避免整列重画
- 形态照搬 DeepSeek 原生导航（尺寸取自其线上样式）：fixed 右侧 16px、垂直居中，容器高度跟条目内容走而不是固定 300px——收起时的透明命中区只覆盖横线那一小条，不能重新撑满右栏挡住正文点击；收起 34px、悬停展开 240px；条目 30px 高，横线 8×2，当前项放大 1.5 倍并变品牌色；展开后列表可滚动并带上下同色渐隐；窄屏也常显（不再按 768px 隐藏）
- 跳转直接改滚动容器的 `scrollTop`：停在底部时站点（Grok 已确认）会把平滑滚动逐帧拉回，动画会被整段吞掉；同时按首条消息距滚动原点的距离让出悬浮标题高度，目标不会被压在标题下面
- 跳回答不止对齐整块消息：DeepSeek 的消息块顶端是「已思考」思考栏，对齐它只会看到思考标题，正文被推到下面。适配项可声明 `replyAnchor(block)`（DeepSeek 取思考区外的第一块 `.ds-markdown`，再落到它的首个子元素），跳回答时按锚点滚动并让光晕圈住锚点本身；没声明锚点的站点仍按整块对齐
- 横线高亮跟随滚动（悬停展开时自动滚进可见范围），阈值是内容区顶端那条线；跳转后按目标气泡（`SITE_ADAPTERS.bubble`）的矩形在固定叠层上短暂发光，不整行刷底，也不受站点包裹层裁剪影响
- 只要识别到 1 条提问就常显（与 DeepSeek 原生导航一致）；SPA 切会话靠 700ms 地址栏轮询重新识别

## 安装与调试

```shell
nub install
nub run hooks   # 指向 .dev/githooks，启用提交前自动升版本+构建
nub run dev
```

把终端输出的 `http://localhost:5173/__vite-plugin-monkey.install.user.js` 装进油猴，打开 https://chat.deepseek.com ，改 `src/main.js` 保存即热更新。`server.open: true` 会在启动时自动打开这个安装页。

注意：严格 CSP 站点会拦 localhost 脚本。调试载入器优先复用页面 script 的 nonce（ChatGPT）；页面策略没有 nonce-source 时（Gemini）改由油猴请求取单文件包，再以页面允许的 `blob:` 执行，改代码后约 1 秒自动重载。Chrome 142+ 还需允许 Local network access，更新过载入器后要在油猴里重装一次 `server:` 版。

## 版本号与发布

版本号在 `vite.config.js` 的 `userscript.version`，由脚本按本地时间生成 `YYYY.MM.DD.HHmm`;

- 提交前钩子 `.dev/githooks/pre-commit` → `.dev/bump-and-build.mjs`：升版本 → 构建 → 核对产物 `@version`，失败还原配置并中断提交
- `nub run release "feat: …"`：升版本 → 构建 → commit → tag → push；`--no-push` 只提交和打标签，`--dry-run` 只预览版本号
- `nub run build`：只构建，不改版本号

## Firefox

装构建版 `dist/deepseek-web-toolkit.user.js`；带 `server:` 前缀的调试版依赖 Vite 服务（CSP 站点由载入器走 nonce 或 blob 单文件包，不依赖本地脚本源）。控制台出现 `[DeepSeek 工具箱] 脚本已加载` 和 `已初始化，会话数 N` 即生效。

## 结构

依赖方向：`main → drag / observer / editor / selection / styles → render / titles / pin / api → dom / path / storage → runtime / constants`。

| 文件 | 职责 |
| --- | --- |
| `src/main.js` | 入口、启动顺序、热更新清理登记 |
| `src/katex-copy.js` | 注入 KaTeX copy-tex，与目录功能无依赖 |
| `src/message-nav.js` | 通用消息导航，按 `SITE_ADAPTERS` 适配各站点 |
| `src/think-collapse.js` | 默认折叠已完成的思考块，只点应用自己的标题栏 |
| `src/runtime.js` | 运行时状态、上一实例回收、页面 window |
| `src/constants.js` | 键名、缩进、布局 data 属性名 |
| `src/storage.js` | GM/localStorage 回退、展开状态、空目录占位（仅内存） |
| `src/dom.js` | DOM 查询、置顶区、原始标题读写、折叠标记 |
| `src/path.js` | 标题 → 目录路径 / 前缀树 / 排序 |
| `src/titles.js` | 完整标题、叶子显示、改名覆盖、自动置顶检测 |
| `src/pin.js` | 用应用菜单置顶，串行队列 |
| `src/api.js` | 登录 token、页面 fetch、`update_title` |
| `src/editor.js` | 应用改名输入框：定位被顶替的行、预填末段、补回前缀 |
| `src/selection.js` | 当前会话高亮、SPA 路由 |
| `src/render.js` | flex order 重排、目录行、新建/重命名行内编辑、折叠 |
| `src/observer.js` | 变更监听、签名、防抖重排 |
| `src/drag.js` | 拖动/放置判定、移动执行、占位清理 |
| `src/folder.js` | 整目录子树改名与占位迁移（拖动与重命名共用） |
| `src/styles.js` | 注入目录/拖动/导航样式；图标字体单独按需加载 |
| `src/utils.js` | 启动等待 |
| `vite.config.js` | userscript 元数据与构建输出 |
| `.dev/*.mjs` | `bump-and-build` / `release` / `dev-kit`（CSP 载入器与单文件调试包）/ 真机调试 `browser-debug` |
| `.dev/githooks/pre-commit` | 提交前升版本 + 构建 |
| `.dev/build/` | 调试产物，已忽略 |
| `nub.lock` | 依赖锁定，由 `nub install` 维护，不要手改 |

## 关键不变量

- **完整标题是唯一事实来源**：解析、排序、置顶、拖动、改名都用 `getChatTitle`，不要用显示文本反推路径。
- **显示标题是视图**：叶子只显示末段，完整路径存 `data-dscf-full-title`；`applyLeafTitle` 切换，`restoreDisplayTitles` 恢复。
- **目录只在置顶区**：`getPinnedSection` / `isAnchorPinned` 是唯一判定，未置顶会话平铺。
- **折叠状态用 data 属性**：`data-dscf-hidden` / `data-dscf-chat`，因为 React 切换选中会重写 `className`。
- **空目录是内存占位**：不写存储，刷新消失；会话拖入改名成功后 `dropExtraFolderChain` 清占位，整目录移动时 `renameExtraFolders` 迁移。
- **整目录移动/改名共用 `moveFolderSubtree`**：`drag.js` 与 `render.js` 都调它，不要各写前缀截取。
- **行内编辑**：新建用 `runtime.newFolder`，重命名用 `runtime.folderRename`；Enter/失焦提交，Esc 取消，输入法组合中的 Enter 不提交。
- **改名不重复提交**：预填只改显示值、不派发 `input`；名称没变时静默还原成完整路径。
- **改名输入框顶替会话行**：`input.ds-input__input` 不是行的子元素，`rebuild` 检测到就跳过一次重排。
- **补前缀要核对服务端**：`ensureServerTitle` 写完读一次列表，仍是末段就再补写；期间 `isRestoringTitle` 暂停重排。
- **签名跳过**：展开/折叠不改变签名，必须 `rebuild(true)`。

## 启动与热更新

`main.js` → `addCSSClass` → `initMessageNav` →（仅 DeepSeek）`addIconFont` / `initKatexCopy` / `initThinkCollapse` → `waitFor` 侧栏会话 → `checkFrontUpdating` → `rebuild(true)` → `observeChatList` / `initDragAndDrop` / `listenDomain`。

非 DeepSeek 站点注入通用样式并启动消息导航后就结束：图标字体在 cdnjs、copy-tex 在 jsdelivr，会被 ChatGPT / Gemini 的 CSP 拦下，Gemini 还会因 Trusted Types 在设置 `script.src` 时抛错，所以这两项必须留在 DeepSeek 分支。

`runtime.js` 在模块加载时回收上一轮实例；HMR 可能只重跑 `main.js`，入口再用 `runtime.initialized` 判断并 `runtime.dispose()`，清理函数登记在 `runtime.disposers`。

## DeepSeek DOM 契约

- 滚动区 `.ds-scroll-area`；内容 `._77cdc67`；置顶分组标题“置顶”/“Pinned”。
- 会话项 `<a class="_546d736" href="/a/chat/s/<id>">`，子元素 `[0]` 焦点环、`[1]` 标题、`[2]` “更多”。
- 选中 class `b64fb9ae`；菜单项文字在 `.ds-dropdown-menu-option__label`。
- 消息项带 `data-virtual-list-item-key`（会话内从 0 递增，切会话会复用）；思考块是 `.ds-message > ._74c0879`，第一个子元素是标题栏、含 `.ds-think-content` 时表示展开。
- 混淆 class 是脆弱契约，改选择器时同步 `dom.js` 与 `main.js` 的 `checkFrontUpdating`。

## 改动路径

- 目录规则/排序 → `path.js` + `render.js`
- 新建文件夹/空目录 → `storage.js` + `render.js` + `drag.js`
- 目录移动/重命名 → `folder.js`；行内交互在 `render.js`
- 显示标题 → `titles.js`
- 拖动/放置 → `drag.js`；置顶 `pin.js`；改名 `api.js`
- 展开持久化 → `storage.js` + `constants.js`
- 通用消息导航 → `message-nav.js`；原生导航隐藏与消息区留白 → `styles.js`
- 思考折叠 → `think-collapse.js`
- DeepSeek 前端更新 → `dom.js` + `checkFrontUpdating`
- 新增交互状态 → `runtime.js` + `runtime.disposers`
- 发布流程 → `.dev/*` + `.dev/githooks/pre-commit`

## 浏览器调试

先问用户要自动调试还是手动调试。

1. 复制登录态（Chrome 136+ 不允许默认配置开远程调试）：

```shell
SRC=~/.config/google-chrome
DST=/tmp/opencode/chrome-debug
rm -rf "$DST" && mkdir -p "$DST/Default"
cp "$SRC/Local State" "$DST/Local State"
cp "$SRC/Default/Cookies" "$DST/Default/Cookies"
cp "$SRC/Default/Preferences" "$DST/Default/Preferences" 2>/dev/null || true
cp -a "$SRC/Default/Local Storage" "$DST/Default/Local Storage"
```

2. 启动 Chrome：`--user-data-dir=$DST --profile-directory=Default --remote-debugging-port=9337 --remote-allow-origins='*'`，打开 `https://chat.deepseek.com/`。
3. 用 `.dev/browser-debug.mjs` eval `dist/deepseek-web-toolkit.user.js`，再 `eval` / `shot` / `key` / `type` / `net` 验证。
4. 用 `localStorage.userToken` 调 `GET /api/v0/chat_session/fetch_page?count=50` 核对服务端标题。
5. 收尾：改回测试标题，`close` 浏览器，`rm -rf $DST`。

## 验证

- 构建：`nub run build`；发布：`nub run release "feat: …"`（钩子走同一套升版本+构建，发布脚本用 `--no-verify` 跳过）。
- 真机：控制台出现 `[DeepSeek 工具箱] 脚本已加载` 和 `已初始化，会话数 N`；确认只有置顶区成目录、叶子只显示末段、未置顶斜杠会话平铺、拖动/置顶/改名可用、新建与删除空目录正常。
- 确认打开会话时已完成的思考块默认收起、思考输出中保持展开、手动展开后不再被收起。
- 确认 DeepSeek 原生导航不再出现，右侧只有脚本的导航（单条提问也常显、窄屏常显）且收起时命中区不压正文，缩放跨过 768px 时导航不闪、右边距不跳变；收起是一列横线，悬停展开提问列表（移开即收回），点击跳到对应提问且不被悬浮标题压住，当前项横线加粗变蓝。
