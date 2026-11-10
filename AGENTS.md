# DeepSeek 工具箱 — Agent Index

DeepSeek 油猴脚本，一个产物包含三块互不依赖的功能：会话目录（把置顶区里名称带 `/` 的会话原地折叠成目录）、KaTeX 复制修正（注入官方 copy-tex）和消息导航（会话内快速跳转到指定消息，**尚未实现**，`src/` 里没有对应模块）。Vite + vite-plugin-monkey，源码在 `src/`，构建产物在 `dist/deepseek-toolkit.user.js`。

## 模块图

依赖方向：`main → drag / observer / editor / selection / styles → render / titles / pin / api → dom / path / storage → runtime / constants`。

| 文件 | 职责 | 关键导出 |
| --- | --- | --- |
| `src/main.js` | 入口、启动顺序、热更新清理登记 | — |
| `src/katex-copy.js` | 注入 KaTeX copy-tex 的样式和脚本，与目录功能无依赖 | `initKatexCopy` |
| （消息导航） | 规划中：会话内消息过多时跳转到指定消息；目前没有实现，不要按已有模块引用 | — |
| `src/runtime.js` | 跨模块运行时状态、上一实例回收、页面 window | `runtime`, `getPageWindow` |
| `src/constants.js` | 键名、目录缩进、布局 data 属性名 | `RUNTIME_KEY`, `EXPANDED_KEY`, `BASE_PADDING`, `INDENT`, `HIDDEN_ATTR`, `CHAT_ATTR` |
| `src/storage.js` | GM/localStorage 回退、展开状态、手动新建的空文件夹占位（仅内存） | `isExpanded`, `setExpanded`, `toggleExpanded`, `getExtraFolders`, `hasExtraFolder`, `addExtraFolder`, `removeExtraFolder`, `dropExtraFolderChain`, `renameExtraFolders` |
| `src/dom.js` | DeepSeek DOM 查询、置顶区、原始标题读写、折叠/目录标记 | `getOriginalAnchors`, `getPinnedSection`, `isAnchorPinned`, `getRawTitle`, `setAnchorTitle`, `setSubtreeHidden`, `isSubtreeHidden`, `markChatRow` |
| `src/path.js` | 会话名 → 目录路径 / 前缀树 / 路径规范化 | `parseChatPath`, `normalizeFolderPath`, `buildTree`, `compareName`, `compareFolder` |
| `src/titles.js` | 完整标题、叶子显示、改名覆盖、自动置顶检测 | `getChatTitle`, `applyLeafTitle`, `syncTitleOverrides`, `detectUnpinnedFolderRename`, `applyTitleOverride` |
| `src/pin.js` | 用应用菜单置顶，串行队列 | `pinChatByMenu` |
| `src/api.js` | 登录 token、页面 fetch、`update_title` | `renameChat` |
| `src/editor.js` | 应用改名输入框：定位被顶替的会话行、就地摆放、预填末段、提交后补回目录前缀 | `syncRenameEditor`, `isRestoringTitle`, `rememberChats`, `disposeRenameEditor` |
| `src/selection.js` | 当前会话高亮、SPA 路由 | `updateSelectedState`, `listenDomain` |
| `src/render.js` | 原地用 flex order 重排、目录行、新建按钮/内联命名行、空目录删除、折叠 | `renderInPlace`, `cleanupInPlace`, `syncNewFolderButton`, `syncNewFolderEditor`, `removeNewFolderButton`, `disposeNewFolderEditor` |
| `src/observer.js` | 变更监听、签名、防抖重排 | `rebuild`, `observeChatList` |
| `src/drag.js` | 拖动/放置判定、移动执行、空目录占位清理 | `initDragAndDrop`, `clearDropHighlight` |
| `src/folder.js` | 整目录子树改名、空目录占位迁移（拖动与重命名共用） | `moveFolderSubtree` |
| `src/styles.js` | 注入 Font Awesome 和目录/拖动样式 | `addCSSClass` |
| `src/utils.js` | 启动等待 | `waitFor` |

## 关键不变量

- **完整标题是唯一事实来源**：目录解析、排序、置顶、拖动、重命名接口都用 `getChatTitle`。不要用显示文本反推路径。
- **显示标题是视图**：置顶目录里的叶子只显示末段；完整路径存 `data-dscf-full-title`，悬停 `title` 也是完整路径。`applyLeafTitle` 负责切换，`restoreDisplayTitles` 在停用时恢复。
- **目录只存在于置顶区**：`getPinnedSection` / `isAnchorPinned` 是唯一判定。未置顶会话平铺，即使名字带 `/`。
- **空文件夹是内存占位**：手动新建但还没有会话的目录只存在 `storage.js` 的内存集合里（不写 `GM_*`/localStorage，刷新页面后消失），只渲染在置顶区主容器里；会话拖入改名成功后 `dropExtraFolderChain` 删掉目标及其祖先的占位，之后目录由会话标题支撑。整目录拖动时 `renameExtraFolders` 迁移子树里的空目录占位。只有“手动新建且整棵子树都没有会话”的目录显示删除按钮。
- **新建入口跟着置顶标题走**：`syncNewFolderButton` 在置顶标题行右侧插入 `+`，每次 `rebuild` 都补回（React 重渲染可能整行替换）；右侧留 22px 避开应用自带的置顶排序按钮。没有置顶区时不显示入口。
- **新建是行内命名，不是弹窗**：点 `+` 后 `runtime.newFolder` 记录 `{ draft }`（初始为默认名「新文件夹」，整段选中，直接输入即替换），`syncNewFolderEditor` 在目录树末尾补一个 `.dscf-new-folder-row`（目录图标 + 输入框），提交前不写存储。Enter/失焦提交，Esc 取消；输入法组合中的 Enter 不提交。提交时才 `addExtraFolder`，清空名称后什么都不创建。新建行借用会话行的 class 取主题文字色（`body` 兜底色是紫色，直接继承会显示成紫色），不给 placeholder 单独上色。
- **目录重命名也是行内编辑**：目录行悬停出现铅笔按钮，点击后 `runtime.folderRename` 记录 `{ path, draft, focusPending }`，`createFolderRow` 把该行内容换成输入框（图标、缩进、位置不变），Enter/失焦提交，Esc 取消。提交时只编辑最后一段（允许输入 `父/子` 改到更深位置），`moveFolderSubtree` 把子树里所有置顶会话的标题前缀改掉，再迁移空目录占位和展开记录；新路径已存在时自然合并。空名称、没改、或要把目录改到自己下面都直接收尾。
- **整目录移动/改名共用一条路径**：`folder.js` 的 `moveFolderSubtree(fromPath, toPath)` 负责收集子树会话、逐个 `renameChat`、迁移空目录占位；`drag.js` 的目录拖动和 `render.js` 的目录重命名都调它，不要各写一份前缀截取逻辑。输入行独立于 `.dscf-folder-row`，不会被 `cleanupInPlace` 清掉；被 React 替换后由 `syncNewFolderEditor` 按草稿重建，并让 `rebuild` 重排一次把 order 放回目录末尾。
- **不改动、不复制会话节点**：只给列表容器加 `display:flex`，用 `order` 和插入的目录行完成层级。保持原节点的选中态、导航和菜单。
- **折叠状态用 data 属性**：`data-dscf-hidden`（折叠隐藏）和 `data-dscf-chat`（已纳入目录）承载布局状态，不用 class。React 在切换选中会话时会重写上一条会话行的 `className`（只保留它自己的类），class 会被一起抹掉，而签名不变又不会触发重排，折叠中的会话就会带着残留 `order` 跑到目录外。选中的 `b64fb9ae` 仍由应用管理，脚本只做补充高亮。
- **改名覆盖**：`TITLE_OVERRIDES` 处理“服务端已改名但应用内存还是旧标题”；应用写回第三个值或用户再改名时自动让位。
- **自动置顶**：`detectUnpinnedFolderRename` 用 `lastTitles` 识别未置顶会话被改名成路径；`pinChatByMenu` 点应用菜单的“置顶”，`pinQueue` 串行化避免点错菜单。
- **文件夹优先**：`renderParent` 先把整棵目录树输出到 order 序列最前面，根级会话、分组标题和占位元素再按原有相对次序排在后面；同一目录下先子目录后叶子，子目录和叶子都按名称排序（中文拼音、数字大小），叶子不沿用应用给的最近更新顺序。
- **改名不重复提交**：预填只改输入框显示值、不派发 `input`；名称没变时在 Enter/失焦前把值静默还原成完整路径，让应用按“没改名”处理。拖动/移动已有 `newTitle !== title` 判断；收尾时若末段没变，先读服务端标题，仍是原完整路径就不发 `update_title`。
- **改名输入框顶替会话行**：应用重命名时会把该会话的 `<a>` 从列表里移除，在同一父容器插入一个 `input.ds-input__input`（`getRenameEditor`）。它不是行的子元素，所以不能靠行内查找判断编辑态；`rebuild` 检测到输入框就整体跳过一次重排，否则输入框会被当成新元素排到容器顶部。
- **改名按末段编辑**：`editor.js` 用 `rememberChats` 保存的上一帧快照（完整标题、folderPath、order、缩进）认出被顶替的会话，把输入框的 order/缩进还原到原行位置并预填末段。应用提交的是输入框内容，所以保存后要把原目录前缀拼回去；带 `/` 的输入视为用户有意改路径，不干预。
- **补前缀要核对服务端**：应用自己的 `update_title` 可能晚于补写请求落库，覆盖掉前缀；`ensureServerTitle` 写完读一次会话列表，标题仍是末段就再补写。补写/核对期间 `isRestoringTitle` 暂停重排，避免行先掉出目录再跳回。
- **签名跳过**：`observer.js` 的签名包含父容器、元素标识、完整标题；展开/折叠不改变签名，必须 `rebuild(true)`。

## 启动与热更新

`main.js` → `addCSSClass` / `initKatexCopy` → `waitFor` 侧栏会话 → `checkFrontUpdating` → `rebuild(true)` → `observeChatList` / `initDragAndDrop` / `listenDomain`。

`runtime.js` 在模块加载时回收上一轮实例。HMR 可能只重跑 `main.js`，所以入口再用 `runtime.initialized` 判断并 `runtime.dispose()`；清理函数登记在 `runtime.disposers`。

## DeepSeek DOM 契约

- 滚动区 `.ds-scroll-area`；内容 `._77cdc67`；分组 `._3098d02`；置顶分组额外 `_63701b7`，标题文字“置顶”/“Pinned”。
- 会话项：`<a class="_546d736" href="/a/chat/s/<id>">`，子元素 `[0]` 焦点环、`[1]` 标题、`[2]` “更多”按钮。
- 选中 class `b64fb9ae`；菜单项文字在 `.ds-dropdown-menu-option__label`。
- 这些混淆 class 是脆弱契约；改选择器时同步 `dom.js` 和 `main.js` 的 `checkFrontUpdating`。

## 改动路径

- 改目录规则/排序 → `path.js` + `render.js`。
- 改新建文件夹/空目录占位 → `storage.js` + `render.js` + `drag.js` 的占位清理。
- 改目录移动/重命名 → `folder.js`；行内编辑交互在 `render.js`。
- 改显示标题（完整 vs 末段）→ `titles.js`；不要改 `render.js` 里的路径解析。
- 改拖动/放置 → `drag.js`；置顶在 `pin.js`，改名在 `api.js`。
- 改展开持久化/存储 → `storage.js` + `constants.js`。
- DeepSeek 前端更新 → `dom.js` 的选择器与 `checkFrontUpdating` 一起改。
- 新增交互状态 → 加到 `runtime.js`，并把清理函数登记进 `runtime.disposers`。
- 消息导航（待实现）→ 新建独立模块并在 `main.js` 启动时调用，不要塞进目录渲染链路。

## 浏览器调试

可以直接打开图形浏览器做真机验证，不必只靠构建和读代码：

0. 打开浏览器之前询问用户是否需要自动调试，还是自己手动调试。

1. **复制登录态**（Chrome 136+ 不允许默认配置开远程调试，且不要驱动日常配置）：

```shell
SRC=~/.config/google-chrome
DST=/tmp/opencode/chrome-debug
rm -rf "$DST" && mkdir -p "$DST/Default"
cp "$SRC/Local State" "$DST/Local State"
cp "$SRC/Default/Cookies" "$DST/Default/Cookies"
cp "$SRC/Default/Preferences" "$DST/Default/Preferences" 2>/dev/null || true
cp -a "$SRC/Default/Local Storage" "$DST/Default/Local Storage"
```

2. **启动带 CDP 的 Chrome**：`--user-data-dir=$DST --profile-directory=Default --remote-debugging-port=9337 --remote-allow-origins='*'`，打开 `https://chat.deepseek.com/`。

3. **注入构建版脚本并验证**：用 `tools/browser-debug.mjs` 在页面里 eval `dist/deepseek-web-toolkit.user.js` 的内容，然后 `eval` 小段 DOM 检查脚本、`shot` 截图、`key`/`type` 模拟交互、`net` 抓接口。

4. **核对服务端数据**：页面里用 `localStorage.userToken` 的 token 调 `GET /api/v0/chat_session/fetch_page?count=50`，确认改名后的标题真的落库；不要只看本地缓存。

5. **收尾**：把测试改过的标题改回原值，`close` 浏览器，`rm -rf $DST`。

常用约定：重命名输入框是 `input.ds-input__input`，会顶替会话行；验证时同时看 DOM 的 `data-dscf-full-title`、显示文本和输入框位置。

## 验证

- 构建：`npm run build`（见 `package.json`；产物写到 `dist/`）。
- 真机：打开 `chat.deepseek.com`，控制台应出现 `[DeepSeek 工具箱] 脚本已加载` 和 `已初始化，会话数 N`；确认只有置顶区成目录、叶子只显示末段、未置顶斜杠会话平铺、拖动/置顶/改名可用。新建入口在“置顶”标题右侧，点 `+` 后目录树末尾应出现带输入框的临时行；Enter/失焦提交、Esc 取消，提交后应变成空目录；拖会话进去应改名并让空目录占位消失；空目录悬停可删除。
- 调试：`npm run dev` 的 `server:` 版本依赖 Vite 服务和 CSP 放行；日常与 Firefox 用构建版。
- 消息导航：尚未实现，没有可验证的入口；实现后在此补充验证步骤。
