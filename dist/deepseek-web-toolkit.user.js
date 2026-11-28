// ==UserScript==
// @name         DeepSeek 修复+优化
// @namespace    http://tampermonkey.net/
// @version      2026.11.28.1822
// @author       sherlocknieh
// @description  优化 DeepSeek 网页端使用体验: KaTeX 公式复制修正 + 会话文件夹 + 消息导航 + 默认折叠思考。
// @license      MIT
// @icon         https://www.deepseek.com/favicon.ico
// @downloadURL  https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js
// @updateURL    https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js
// @match        https://chat.deepseek.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
// @match        https://sichang.xyz/*
// @match        https://*.sichang.xyz/*
// @match        https://venice.ai/*
// @match        https://*.venice.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
	"use strict";
	var _unsafeWindow = (() => typeof unsafeWindow != "undefined" ? unsafeWindow : void 0)();
	var RUNTIME_KEY = "__deepseek_chat_folders_runtime__";
	var EXPANDED_KEY = "path_folders_expanded";
	var NAV_POSITION_KEY = "message_nav_position";
	var HIDDEN_ATTR = "data-dscf-hidden";
	var CHAT_ATTR = "data-dscf-chat";
	var previousRuntime = window[RUNTIME_KEY];
	if (previousRuntime && typeof previousRuntime.dispose === "function") previousRuntime.dispose();
	var runtime = {
		observer: null,
		timer: null,
		onRouteChange: null,
		drag: null,
		dropKey: null,
		moving: false,
		dragAbort: null,
		newFolder: null,
		folderRename: null,
		pinning: new Set(),
		disposers: [],
		refreshSelection: null,
		refreshMessageNav: null,
		rebuild: null,
		initialized: false,
		dispose: null
	};
	window[RUNTIME_KEY] = runtime;
	runtime.dispose = () => {
		if (runtime.timer) {
			clearTimeout(runtime.timer);
			runtime.timer = null;
		}
		if (runtime.observer) {
			runtime.observer.disconnect();
			runtime.observer = null;
		}
		if (runtime.onRouteChange) {
			window.removeEventListener("popstate", runtime.onRouteChange);
			window.removeEventListener("hashchange", runtime.onRouteChange);
			runtime.onRouteChange = null;
		}
		if (runtime.dragAbort) {
			runtime.dragAbort.abort();
			runtime.dragAbort = null;
		}
		runtime.drag = null;
		runtime.moving = false;
		runtime.newFolder = null;
		runtime.pinning.clear();
		const disposers = runtime.disposers;
		runtime.disposers = [];
		disposers.forEach((fn) => {
			try {
				fn();
			} catch (err) {
				console.warn("[DeepSeek 工具箱] 清理失败", err);
			}
		});
	};
	function getPageWindow() {
		return typeof _unsafeWindow !== "undefined" && _unsafeWindow ? _unsafeWindow : window;
	}
	function addCSSClass() {
		document.getElementById("dscf-style")?.remove();
		const style = document.createElement("style");
		style.id = "dscf-style";
		style.textContent = `
        /* 让会话列表容器按 order 排列，从而在不移动 DOM 的前提下形成层级 */
        .dscf-list-parent {
            display: flex !important;
            flex-direction: column;
        }

        /* 折叠时隐藏该文件夹下的所有会话与子目录行；
           用 data 属性而不是 class，避免 React 切换选中态重写 className 时被抹掉 */
        [data-dscf-hidden] {
            display: none !important;
        }

        /* 目录行和新建输入行沿用会话项的字体和悬停样式，只额外加文件夹图标 */
        .dscf-folder-row,
        .dscf-new-folder-row {
            display: flex;
            align-items: center;
            justify-content: flex-start !important;
            min-height: 40px;
            box-sizing: border-box;
            border-radius: 12px;
            cursor: pointer;
            position: relative;
        }

        /* 新建行正在等待命名：用浅色底提示这是临时行，不是已存在的目录 */
        .dscf-new-folder-row {
            cursor: text;
            background-color: rgba(103, 112, 254, 0.10);
        }

        .dscf-folder-row::before,
        .dscf-new-folder-row::before {
            content: "\\f07b";
            font-family: "Font Awesome 6 Free";
            font-weight: 900;
            color: #6770FE;
            display: inline-block;
            flex: 0 0 16px;
            width: 16px;
            margin-right: 6px;
            text-align: center;
        }

        .dscf-folder-row.dscf-folder-open::before {
            content: "\\f07c";
        }

        /* 新建行里的输入框：去掉边框和背景，看起来像直接在选择目录名 */
        .dscf-new-folder-input {
            flex: 1 1 auto;
            min-width: 0;
            width: 100%;
            padding: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            line-height: inherit;
        }

        .dscf-folder-name {
            flex: 1 1 auto;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 0;
        }

        /* 正在重命名的目录行：和新建行一样用浅色底提示处于编辑状态 */
        .dscf-folder-renaming {
            background-color: rgba(103, 112, 254, 0.10);
            cursor: text;
        }

        /* 置顶标题行右侧的新建文件夹按钮：无边框小图标，悬停时才变明显。
           margin-right 给应用自带的置顶排序按钮（绝对定位在右侧）留出位置 */
        .dscf-new-folder {
            margin-left: auto;
            margin-right: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0.65;
        }

        .dscf-new-folder:hover {
            opacity: 1;
            color: #6770FE;
            background-color: rgba(103, 112, 254, 0.16);
        }

        /* 目录行的重命名/删除按钮：默认隐藏，悬停目录行才出现，避免误触 */
        .dscf-folder-rename,
        .dscf-folder-remove {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 18px;
            width: 18px;
            height: 18px;
            margin-left: 2px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0;
            pointer-events: none;
        }

        .dscf-folder-row:hover .dscf-folder-rename,
        .dscf-folder-row:hover .dscf-folder-remove,
        .dscf-folder-row:focus-within .dscf-folder-rename,
        .dscf-folder-row:focus-within .dscf-folder-remove {
            opacity: 0.6;
            pointer-events: auto;
        }

        .dscf-folder-rename:hover {
            opacity: 1;
            color: #6770FE;
            background-color: rgba(103, 112, 254, 0.16);
        }

        .dscf-folder-remove:hover {
            opacity: 1;
            color: #ff5c5c;
            background-color: rgba(255, 92, 92, 0.12);
        }

        /* 拖动时高亮可放置的目录/会话行；拖到空白处表示移回根级 */
        .dscf-drop-target {
            background-color: rgba(103, 112, 254, 0.16) !important;
            outline: 1.5px dashed rgba(103, 112, 254, 0.75);
            outline-offset: -2px;
        }

        .dscf-drop-root {
            box-shadow: inset 0 0 0 1.5px rgba(103, 112, 254, 0.55);
        }

        /* 通用消息导航（所有站点；DeepSeek 的原生导航已隐藏）：右侧一列横线，
           悬停展开成 240 宽、按内容高度垂直居中的实色提问列表。
           容器高度跟着横线数量走，收起时命中区只有 34px 宽的一小条，
           不会留下一整条透明区域挡住正文右侧的点击 */
        .dscf-msgnav {
            --dscf-nav-solid: #ffffff;
            --dscf-nav-border: transparent;
            --dscf-nav-shadow: 0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08);
            --dscf-nav-title: #81858c;
            --dscf-nav-hover: #0f1115;
            --dscf-nav-line: rgba(0, 0, 0, 0.16);
            --dscf-nav-divider: rgba(0, 0, 0, 0.08);
            --dscf-nav-active: #3964fe;
            --dscf-nav-switch: rgba(0, 0, 0, 0.06);
            --dscf-nav-thumb: #ffffff;
            --dscf-nav-thumb-shadow: 0 1px 3px rgba(0, 0, 0, 0.16);
            position: fixed;
            top: 50%;
            right: 16px;
            transform: translateY(-50%);
            width: 34px;
            z-index: 40;
            display: none;
            /* 列表靠右对齐，展开时向左溢出容器；容器自身仍是 34px */
            justify-content: flex-end;
            user-select: none;
        }

        .dscf-msgnav.is-visible {
            display: flex;
        }

        /* [导航顶栏] 吸附左边：列表改为向右展开，条目整体镜像，横线仍贴着屏幕边缘 */
        .dscf-msgnav.is-left {
            justify-content: flex-start;
        }

        .dscf-msgnav.is-left .dscf-msgnav-items {
            padding: 6px;
        }

        .dscf-msgnav.is-left .dscf-msgnav-item {
            flex-direction: row-reverse;
        }

        .dscf-msgnav.is-left .dscf-msgnav-jump {
            justify-content: flex-start;
        }

        /* 窄屏也让出位置而不是整个隐藏：收起时只是右侧一列 34px 宽的横线，展开是悬停操作，
           压住正文的范围有限，隐藏反而让窄屏用户完全用不到导航 */

        /* 列表宽度固定 240：收起时透明、只漏出右侧横线，展开时条目不再横向跳动。
           高度由条目内容决定，容器不再撑到固定 300px */
        .dscf-msgnav-list {
            position: relative;
            flex: 0 0 240px;
            display: flex;
            flex-direction: column;
            max-height: min(322px, calc(100vh - 32px));
            box-sizing: border-box;
            border: 1px solid transparent;
            border-radius: 6px;
            overflow: hidden;
            pointer-events: none;
            transition: background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-list {
            background-color: var(--dscf-nav-solid);
            border-color: var(--dscf-nav-border);
            box-shadow: var(--dscf-nav-shadow);
            pointer-events: auto;
        }

        /* [导航顶栏/拖动条]: 展开后压在列表顶部，左端拖动把手、右端隐藏按钮；
           整条都是拖动区，拖动时保持实色展开，松手按指针所在半屏吸附左右边缘 */
        .dscf-msgnav-bar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            height: 28px;
            padding: 0 6px 0;
            box-sizing: border-box;
            border-bottom: 1px solid var(--dscf-nav-divider);
            cursor: grab;
            opacity: 0;
            touch-action: none;
            transition: opacity 0.1s ease;
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-bar,
        .dscf-msgnav.is-dragging .dscf-msgnav-bar {
            opacity: 1;
        }

        .dscf-msgnav.is-dragging .dscf-msgnav-bar {
            cursor: grabbing;
        }

        /* 拖动时指针会移出胶囊，强制保留展开态，免得列表半路消失 */
        .dscf-msgnav.is-dragging .dscf-msgnav-list {
            background-color: var(--dscf-nav-solid);
            border-color: var(--dscf-nav-border);
            box-shadow: var(--dscf-nav-shadow);
            pointer-events: auto;
        }

        /* 松手后滑向吸附边：过渡只在飞行期间生效，拖动时逐帧跟手 */
        .dscf-msgnav.is-flying {
            transition: left 0.26s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.26s cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        .dscf-msgnav-grip {
            display: inline-flex;
            color: var(--dscf-nav-title);
        }

        .dscf-msgnav-grip svg {
            display: block;
            width: 10px;
            height: 10px;
        }

        /* [导航关闭图标]: 顶栏右端，点击只隐藏本页的导航（刷新后恢复），不写存储 */
        .dscf-msgnav-close {
            margin-left: auto;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: transparent;
            color: var(--dscf-nav-title);
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.1s ease, color 0.2s ease, background-color 0.2s ease;
        }

        .dscf-msgnav-close svg {
            display: block;
            width: 11px;
            height: 11px;
        }

        .dscf-msgnav-close:hover,
        .dscf-msgnav-close:focus-visible {
            opacity: 1;
            color: var(--dscf-nav-hover);
            background-color: rgba(103, 112, 254, 0.16);
        }

        /* 列表高度随条目走，最多撑满容器；条目整体垂直居中 */
        .dscf-msgnav-items {
            flex: 0 1 auto;
            max-height: 290px;
            padding: 6px;
            box-sizing: border-box;
            overflow-y: auto;
            scrollbar-width: none;
        }

        .dscf-msgnav-items::-webkit-scrollbar {
            width: 0;
        }

        /* 一项一条消息：行首是预览开关、中间是预览文字、行尾是横线；收起时文字和开关透明，
           只留横线。整行都是命中区（横线也点得动），开关负责切换提问/回答预览 */
        .dscf-msgnav-item {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            width: 100%;
            height: 30px;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        .dscf-msgnav-jump {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
            padding: 0 6px;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        /* 行首的提问/回答开关：两枚图标同处一条胶囊形轨道，选中侧浮起成白色滑块，
           形状和分段开关一致；与行尾横线分居两端，收起时整条轨道随文字一起透明 */
        .dscf-msgnav-roles {
            flex: 0 0 auto;
            display: inline-flex;
            align-items: center;
            gap: 0;
            padding: 2px;
            border-radius: 999px;
            background-color: transparent;
            transition: background-color 0.2s ease;
        }

        .dscf-msgnav-role {
            flex: 0 0 18px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: transparent;
            color: var(--dscf-nav-title);
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.1s ease, color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
        }

        .dscf-msgnav-role svg {
            display: block;
            width: 12px;
            height: 12px;
        }

        /* 预览文字：提问和回答叠在同一个位置，宽度靠 flex-grow 一收一放；
           同时只显示当前预览的那一侧，切换时像标题收缩、另一侧展开 */
        .dscf-msgnav-preview {
            flex: 1 1 auto;
            min-width: 0;
            display: flex;
            align-items: center;
            overflow: hidden;
        }

        .dscf-msgnav-text {
            flex: 0 0 0;
            min-width: 0;
            font-size: 13px;
            line-height: 20px;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            color: var(--dscf-nav-title);
            opacity: 0;
            transition: flex-grow 0.18s ease, opacity 0.18s ease, color 0.2s ease;
        }

        /* 展开列表（悬停或键盘聚焦）时，只让当前预览侧从 0 宽度长到整行 */
        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-item:not(.is-showing-answer) .dscf-msgnav-text-question,
        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-item.is-showing-answer .dscf-msgnav-text-answer {
            flex-grow: 1;
            opacity: 1;
        }

        /* 展开时露出开关轨道，两个图标一起露面：选中侧是浮起的白色滑块 + 品牌色图标，
           未选中侧压到 0.4 亮度，滑块位置随预览侧在左右两格之间切换 */
        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-roles {
            background-color: var(--dscf-nav-switch);
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-role {
            opacity: 0.4;
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-item:not(.is-showing-answer) .dscf-msgnav-role-question,
        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-item.is-showing-answer .dscf-msgnav-role-answer {
            opacity: 1;
            color: var(--dscf-nav-active);
            background-color: var(--dscf-nav-thumb);
            box-shadow: var(--dscf-nav-thumb-shadow);
        }

        /* 悬停未选中侧：只提亮图标，滑块仍由上面的规则固定 */
        .dscf-msgnav:hover .dscf-msgnav-role:hover,
        .dscf-msgnav:has(:focus-visible) .dscf-msgnav-role:focus-visible {
            opacity: 1;
            color: var(--dscf-nav-hover);
        }

        /* 回答还没出现：答按钮不占位，问按钮旁边只留它自己 */
        .dscf-msgnav-role:disabled {
            display: none;
        }

        /* 一个提问下有多条独立回答时，每条回答单独占一行子条目：
           行首是序号（不是按钮，悬停才显形），文字直接显示该条回答的预览，
           点击切到这条回答并跳过去；行高比父条目矮一档，视觉上从属于上一问 */
        .dscf-msgnav-item.is-sub {
            height: 24px;
        }

        .dscf-msgnav-item.is-sub .dscf-msgnav-jump {
            padding-left: 14px;
        }

        .dscf-msgnav-item.is-sub .dscf-msgnav-text {
            font-size: 12px;
            line-height: 18px;
        }

        .dscf-msgnav-item.is-sub .dscf-msgnav-roles {
            gap: 2px;
            padding: 0;
            background-color: transparent;
        }

        .dscf-msgnav-subindex {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 16px;
            border-radius: 999px;
            color: var(--dscf-nav-title);
            font-size: 10px;
            line-height: 1;
            font-variant-numeric: tabular-nums;
            opacity: 0;
            transition: opacity 0.1s ease, color 0.2s ease;
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-subindex {
            opacity: 0.55;
        }

        .dscf-msgnav:is(:hover, .is-open, :has(:focus-visible), .is-flying) .dscf-msgnav-item.is-sub.is-active .dscf-msgnav-subindex {
            color: var(--dscf-nav-active);
            opacity: 1;
        }

        /* 横线的定位盒固定 16×20，横线本身 8×2；当前项放大 1.5 倍并变成品牌色。
           收起时列表整体不接事件，唯独横线这一小条重新打开命中：触屏第一次点横线
           也能直接跳转，不会因为面板还没展开而丢掉点击 */
        .dscf-msgnav-indicator {
            flex: 0 0 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 16px;
            height: 20px;
            pointer-events: auto;
        }

        .dscf-msgnav-line {
            width: 8px;
            height: 2px;
            border-radius: 4px;
            background-color: var(--dscf-nav-line);
            transition: background-color 0.2s ease, transform 0.2s ease;
        }

        /* 悬停条目：预览文字、图标和横线一起提到正文色 */
        .dscf-msgnav-item:hover .dscf-msgnav-line {
            background-color: var(--dscf-nav-hover);
        }

        .dscf-msgnav-item:hover .dscf-msgnav-text,
        .dscf-msgnav-item:hover .dscf-msgnav-role {
            color: var(--dscf-nav-hover);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-line {
            background-color: var(--dscf-nav-active);
            transform: scale(1.5);
        }

        .dscf-msgnav-item.is-active .dscf-msgnav-text {
            color: var(--dscf-nav-active);
            font-weight: 500;
        }

        /* 当前条目上，只有正在预览的一侧图标跟随品牌色 */
        .dscf-msgnav-item.is-active:not(.is-showing-answer) .dscf-msgnav-role-question,
        .dscf-msgnav-item.is-active.is-showing-answer .dscf-msgnav-role-answer {
            color: var(--dscf-nav-active);
        }

        /* 深色主题：各站点标记不同（ChatGPT/Grok 用 html.dark，DeepSeek 用 body.dark，
           Gemini 用 dark-theme / data-theme），全部跟随，免得深色底上画出浅色面板 */
        html.dark .dscf-msgnav,
        body.dark .dscf-msgnav,
        .dark-theme .dscf-msgnav,
        [data-theme="dark"] .dscf-msgnav {
            --dscf-nav-solid: #232324;
            --dscf-nav-border: rgba(255, 255, 255, 0.06);
            --dscf-nav-title: #adb2b8;
            --dscf-nav-hover: #f9fafb;
            --dscf-nav-line: rgba(255, 255, 255, 0.2);
            --dscf-nav-divider: rgba(255, 255, 255, 0.08);
            --dscf-nav-active: #679efe;
            --dscf-nav-switch: rgba(255, 255, 255, 0.1);
            --dscf-nav-thumb: #4a4a4e;
            --dscf-nav-thumb-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        }

        /* 跳转目标的气泡边缘发光：只画光圈不铺底色，正文颜色不受影响。
           气泡外面的包裹层带裁剪，光晕画在气泡上会缺一条边，所以铺一层固定定位的
           叠层，尺寸与圆角每次按气泡实时对齐；淡出时长由 message-nav.js 的 FLASH_MS 决定 */
        .dscf-halo {
            position: fixed;
            pointer-events: none;
            z-index: 2147483000;
            opacity: 0;
            box-shadow: inset 0 0 0 2px rgba(103, 112, 254, 0.85),
                0 0 16px 4px rgba(103, 112, 254, 0.45);
        }

        /* DeepSeek 原生消息导航由通用导航完全替代：直接隐藏，避免两套胶囊并存 */
        [style*="--scroll-nav-page-padding"] {
            display: none !important;
        }

        /* 窄屏给消息列表补右内边距，避开右上常显的通用导航。应用在 768px 处把列表
           外边距从 44px 收到 20px，这里把下限同步从 14px 提到 38px，右侧总留白
           全程都是 58px，缩放跨断点不再突然变宽 */
        .ds-virtual-list--printable .ds-virtual-list-items {
            padding-right: max(calc((100% - var(--message-list-max-width)) / 2), 14px) !important;
        }

        @media not all and (min-width: 768px) {
            .ds-virtual-list--printable .ds-virtual-list-items {
                padding-right: max(calc((100% - var(--message-list-max-width)) / 2), 38px) !important;
            }
        }
    `;
		document.head.appendChild(style);
	}
	function addIconFont() {
		document.getElementById("dscf-fontawesome")?.remove();
		const iconLink = document.createElement("link");
		iconLink.id = "dscf-fontawesome";
		iconLink.rel = "stylesheet";
		iconLink.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
		document.head.appendChild(iconLink);
	}
	function waitFor(cond, func, timeout = 6e4) {
		if (cond()) {
			func();
			return;
		}
		const observer = new MutationObserver(function() {
			if (cond()) {
				observer.disconnect();
				func();
			}
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
		setTimeout(() => observer.disconnect(), timeout);
	}
	function getScrollArea() {
		return document.querySelector(".ds-scroll-area");
	}
	function setSubtreeHidden(el, hidden) {
		if (!el) return;
		if (hidden) el.setAttribute(HIDDEN_ATTR, "1");
		else el.removeAttribute(HIDDEN_ATTR);
	}
	function isSubtreeHidden(el) {
		return !!el && el.hasAttribute("data-dscf-hidden");
	}
	function markChatRow(anchor, marked) {
		if (!anchor) return;
		if (marked) anchor.setAttribute(CHAT_ATTR, "1");
		else anchor.removeAttribute(CHAT_ATTR);
	}
	function getOriginalAnchors() {
		const scrollArea = getScrollArea();
		return scrollArea ? Array.from(scrollArea.querySelectorAll("a[href^=\"/a/chat/s/\"]")) : [];
	}
	function getPinnedSection() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return null;
		const byClass = scrollArea.querySelector("._63701b7");
		if (byClass && /^(置顶|Pinned)/.test((byClass.innerText || "").trim())) return byClass;
		const content = scrollArea.querySelector("._77cdc67") || scrollArea;
		const byText = Array.from(content.children).find((sec) => /^(置顶|Pinned)/.test((sec.innerText || "").trim()));
		if (byText) return byText;
		const label = Array.from(scrollArea.querySelectorAll("span, div")).find((el) => el.children.length === 0 && /^(置顶|Pinned)$/.test((el.textContent || "").trim()));
		if (!label) return null;
		let section = label;
		while (section && section !== scrollArea && !section.querySelector("a[href^=\"/a/chat/s/\"]")) section = section.parentElement;
		return section && section !== scrollArea ? section : null;
	}
	function isAnchorPinned(anchor) {
		const section = getPinnedSection();
		return !!section && section.contains(anchor);
	}
	function getAnchorClass() {
		const first = getOriginalAnchors()[0];
		return first ? first.classList[0] : "";
	}
	function getAnchorSelectedClass() {
		return "b64fb9ae";
	}
	function getRenameEditor() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return null;
		return scrollArea.querySelector("input.ds-input__input");
	}
	function getRawTitle(chatAnchor) {
		const titleEl = chatAnchor.children[1];
		return ((titleEl && titleEl.textContent.trim() ? titleEl.textContent : chatAnchor.textContent) || "").trim();
	}
	function setAnchorTitle(anchor, title) {
		const titleEl = anchor.children[1];
		if (!titleEl) return;
		const textNode = document.createTreeWalker(titleEl, NodeFilter.SHOW_TEXT).nextNode();
		if (textNode) textNode.nodeValue = title;
		else titleEl.textContent = title;
	}
	function getChatIdFromHref(anchor) {
		const match = (anchor.getAttribute("href") || "").match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
		return match ? match[1] : null;
	}
	function extractIdFromUrl(url) {
		try {
			const match = new URL(url).pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
			return match ? match[1] : null;
		} catch (e) {
			console.error("Invalid URL:", e);
			return null;
		}
	}
	function parseChatPath(title) {
		const parts = title.split("/").map((s) => s.trim()).filter(Boolean);
		if (parts.length < 2) return null;
		return {
			folderPath: parts,
			chatName: parts.pop()
		};
	}
	function normalizeFolderPath(raw) {
		return String(raw || "").split("/").map((segment) => segment.trim()).filter(Boolean).join("/");
	}
	function buildTree(chats, extraFolders = []) {
		const root = {
			name: "",
			path: "",
			children: new Map(),
			chats: []
		};
		const ensureNode = (folderPath) => {
			let node = root;
			for (const segment of folderPath) {
				let child = node.children.get(segment);
				if (!child) {
					child = {
						name: segment,
						path: node.path ? node.path + "/" + segment : segment,
						children: new Map(),
						chats: []
					};
					node.children.set(segment, child);
				}
				node = child;
			}
			return node;
		};
		extraFolders.forEach((path) => {
			const folderPath = String(path || "").split("/").filter(Boolean);
			if (folderPath.length) ensureNode(folderPath);
		});
		chats.forEach((chat) => {
			ensureNode(chat.folderPath).chats.push(chat);
		});
		return root;
	}
	function compareName(a, b) {
		return a.localeCompare(b, "zh-CN", { numeric: true });
	}
	function compareFolder(a, b) {
		return compareName(a.name, b.name);
	}
	function findMenuLabel(text) {
		return Array.from(document.querySelectorAll(".ds-dropdown-menu-option__label")).find((el) => el.textContent.trim() === text) || null;
	}
	function waitUntil(predicate, timeout = 2e3, interval = 50) {
		return new Promise((resolve) => {
			const start = Date.now();
			const tick = () => {
				let ok = false;
				try {
					ok = predicate();
				} catch (e) {
					ok = false;
				}
				if (ok) return resolve(true);
				if (Date.now() - start >= timeout) return resolve(false);
				setTimeout(tick, interval);
			};
			tick();
		});
	}
	var pinQueue = Promise.resolve();
	function pinChatByMenu(chatId) {
		const run = pinQueue.then(() => doPinChatByMenu(chatId));
		pinQueue = run.catch(() => void 0);
		return run;
	}
	async function doPinChatByMenu(chatId) {
		if (runtime.pinning.has(chatId)) return false;
		runtime.pinning.add(chatId);
		try {
			let anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === chatId);
			if (!anchor) return false;
			if (isAnchorPinned(anchor)) return true;
			if (document.querySelector(".ds-floating-position-wrapper")) {
				document.body.click();
				await waitUntil(() => !document.querySelector(".ds-floating-position-wrapper"), 500);
			}
			const menuBtn = anchor.children[2] ? anchor.children[2].querySelector("[role=\"button\"]") : null;
			if (!menuBtn) return false;
			menuBtn.click();
			if (!await waitUntil(() => !!(findMenuLabel("置顶") || findMenuLabel("Pin")), 1500)) {
				document.body.click();
				return false;
			}
			const label = findMenuLabel("置顶") || findMenuLabel("Pin");
			(label.closest(".ds-dropdown-menu-option") || label).click();
			const moved = await waitUntil(() => {
				const current = getOriginalAnchors().find((a) => getChatIdFromHref(a) === chatId);
				return !!current && isAnchorPinned(current);
			}, 3e3);
			if (!moved) document.body.click();
			return moved;
		} finally {
			runtime.pinning.delete(chatId);
		}
	}
	var TITLE_OVERRIDES = new Map();
	var lastTitles = new Map();
	function getChatTitle(chatAnchor) {
		const stored = chatAnchor.dataset ? chatAnchor.dataset.dscfFullTitle : "";
		if (!stored) return getRawTitle(chatAnchor);
		const raw = getRawTitle(chatAnchor);
		const parsed = parseChatPath(stored);
		const leaf = parsed ? parsed.chatName : stored;
		if (raw === stored || raw === leaf) return stored;
		delete chatAnchor.dataset.dscfFullTitle;
		return raw;
	}
	function applyLeafTitle(anchor, fullTitle, showLeaf) {
		const parsed = parseChatPath(fullTitle);
		const leaf = parsed ? parsed.chatName : fullTitle;
		const stored = anchor.dataset.dscfFullTitle;
		if (!showLeaf) {
			if (stored) {
				if (getRawTitle(anchor) !== fullTitle) setAnchorTitle(anchor, fullTitle);
				delete anchor.dataset.dscfFullTitle;
			}
			if (anchor.dataset.dscfTitleSet) {
				anchor.removeAttribute("title");
				delete anchor.dataset.dscfTitleSet;
			}
			return;
		}
		anchor.dataset.dscfFullTitle = fullTitle;
		if (getRawTitle(anchor) !== leaf) setAnchorTitle(anchor, leaf);
		if (anchor.dataset.dscfTitleSet) {
			if (anchor.title !== fullTitle) anchor.title = fullTitle;
		} else if (!anchor.hasAttribute("title")) {
			anchor.title = fullTitle;
			anchor.dataset.dscfTitleSet = "1";
		}
	}
	function restoreDisplayTitles() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		scrollArea.querySelectorAll("a[data-dscf-full-title]").forEach((anchor) => {
			const fullTitle = anchor.dataset.dscfFullTitle;
			if (fullTitle) setAnchorTitle(anchor, fullTitle);
			delete anchor.dataset.dscfFullTitle;
			if (anchor.dataset.dscfTitleSet) {
				anchor.removeAttribute("title");
				delete anchor.dataset.dscfTitleSet;
			}
		});
	}
	function syncTitleOverrides(anchors) {
		const present = new Set();
		anchors.forEach((anchor) => {
			const chatId = getChatIdFromHref(anchor);
			if (!chatId) return;
			present.add(chatId);
			const override = TITLE_OVERRIDES.get(chatId);
			if (!override) return;
			const domTitle = getChatTitle(anchor);
			if (domTitle === override.to) return;
			if (domTitle === override.from) setAnchorTitle(anchor, override.to);
			else TITLE_OVERRIDES.delete(chatId);
		});
		Array.from(TITLE_OVERRIDES.keys()).forEach((chatId) => {
			if (!present.has(chatId)) TITLE_OVERRIDES.delete(chatId);
		});
	}
	function detectUnpinnedFolderRename(anchors) {
		const nextTitles = new Map();
		anchors.forEach((anchor) => {
			const chatId = getChatIdFromHref(anchor);
			if (!chatId) return;
			const title = getChatTitle(anchor);
			nextTitles.set(chatId, title);
			const previous = lastTitles.get(chatId);
			if (previous === void 0 || previous === title) return;
			if (!parseChatPath(title)) return;
			if (isAnchorPinned(anchor)) return;
			if (runtime.moving || runtime.pinning.has(chatId)) return;
			pinChatByMenu(chatId).then((ok) => {
				if (!ok) console.warn("[DeepSeek 工具箱] 自动置顶失败，可能已达置顶上限");
			});
		});
		lastTitles.clear();
		nextTitles.forEach((title, chatId) => lastTitles.set(chatId, title));
	}
	function applyTitleOverride(chatId, fromTitle, toTitle) {
		const existing = TITLE_OVERRIDES.get(chatId);
		TITLE_OVERRIDES.set(chatId, {
			from: existing ? existing.from : fromTitle,
			to: toTitle
		});
		const anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === chatId);
		if (anchor) {
			if (anchor.dataset.dscfFullTitle) anchor.dataset.dscfFullTitle = toTitle;
			setAnchorTitle(anchor, toTitle);
		}
	}
	function storageGet(key, fallback) {
		try {
			if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
		} catch (e) {}
		try {
			const value = getPageWindow().localStorage.getItem(key);
			return value === null ? fallback : value;
		} catch (e) {
			return fallback;
		}
	}
	function storageSet(key, value) {
		try {
			if (typeof GM_setValue === "function") {
				GM_setValue(key, value);
				return;
			}
		} catch (e) {}
		try {
			getPageWindow().localStorage.setItem(key, value);
		} catch (e) {}
	}
	function readJson(key, fallback) {
		const raw = storageGet(key, null);
		if (!raw) return fallback;
		try {
			return JSON.parse(raw);
		} catch (e) {
			return fallback;
		}
	}
	var storedExpanded = readJson(EXPANDED_KEY, {});
	var EXPANDED = storedExpanded && typeof storedExpanded === "object" && !Array.isArray(storedExpanded) ? storedExpanded : {};
	function isExpanded(path) {
		return !!EXPANDED[path];
	}
	function setExpanded(path, expanded) {
		if (expanded) EXPANDED[path] = true;
		else delete EXPANDED[path];
		storageSet(EXPANDED_KEY, JSON.stringify(EXPANDED));
	}
	function toggleExpanded(path) {
		setExpanded(path, !EXPANDED[path]);
		return !!EXPANDED[path];
	}
	function renameExpandedFolders(fromPath, toPath) {
		if (!fromPath || !toPath || fromPath === toPath) return false;
		let changed = false;
		Object.keys(EXPANDED).forEach((key) => {
			if (key !== fromPath && !key.startsWith(fromPath + "/")) return;
			delete EXPANDED[key];
			EXPANDED[toPath + key.slice(fromPath.length)] = true;
			changed = true;
		});
		if (changed) storageSet(EXPANDED_KEY, JSON.stringify(EXPANDED));
		return changed;
	}
	var EXTRA_FOLDERS = new Set();
	function getExtraFolders() {
		return Array.from(EXTRA_FOLDERS);
	}
	function hasExtraFolder(path) {
		return EXTRA_FOLDERS.has(path);
	}
	function addExtraFolder(path) {
		if (!path || EXTRA_FOLDERS.has(path)) return false;
		EXTRA_FOLDERS.add(path);
		return true;
	}
	function removeExtraFolder(path) {
		let changed = false;
		Array.from(EXTRA_FOLDERS).forEach((item) => {
			if (item === path || item.startsWith(path + "/")) {
				EXTRA_FOLDERS.delete(item);
				changed = true;
			}
		});
		return changed;
	}
	function dropExtraFolderChain(path) {
		if (!path) return false;
		const chain = path.split("/");
		let changed = false;
		for (let i = 1; i <= chain.length; i++) if (EXTRA_FOLDERS.delete(chain.slice(0, i).join("/"))) changed = true;
		return changed;
	}
	function renameExtraFolders(fromPath, toPath) {
		if (!fromPath || !toPath || fromPath === toPath) return false;
		let changed = false;
		Array.from(EXTRA_FOLDERS).forEach((item) => {
			if (item !== fromPath && !item.startsWith(fromPath + "/")) return;
			EXTRA_FOLDERS.delete(item);
			EXTRA_FOLDERS.add(toPath + item.slice(fromPath.length));
			changed = true;
		});
		return changed;
	}
	function updateSelectedState() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		const selectedClass = getAnchorSelectedClass();
		const chatId = extractIdFromUrl(location.href);
		scrollArea.querySelectorAll("a[href^=\"/a/chat/s/\"]").forEach((anchor) => {
			anchor.classList.remove(selectedClass);
		});
		scrollArea.querySelectorAll(".dscf-folder-row").forEach((row) => {
			row.classList.remove(selectedClass);
		});
		if (!chatId) return;
		const activeAnchor = scrollArea.querySelector(`a[href="/a/chat/s/${chatId}"]`);
		if (!activeAnchor) return;
		activeAnchor.classList.add(selectedClass);
		if (!isSubtreeHidden(activeAnchor)) return;
		const parsed = parseChatPath(getChatTitle(activeAnchor));
		if (!parsed) return;
		const fullPath = parsed.folderPath.join("/");
		const visibleRows = Array.from(scrollArea.querySelectorAll(".dscf-folder-row")).filter((row) => !isSubtreeHidden(row) && (fullPath === row.dataset.path || fullPath.startsWith(row.dataset.path + "/")));
		if (visibleRows.length) visibleRows[visibleRows.length - 1].classList.add(selectedClass);
	}
	function listenDomain() {
		runtime.onRouteChange = () => {
			updateSelectedState();
			runtime.refreshMessageNav?.();
		};
		window.addEventListener("popstate", runtime.onRouteChange);
		window.addEventListener("hashchange", runtime.onRouteChange);
		if (!window.__dscfHistoryPatched) {
			window.__dscfHistoryPatched = true;
			["pushState", "replaceState"].forEach((fn) => {
				const orig = history[fn];
				history[fn] = function(...args) {
					const ret = orig.apply(this, args);
					window[RUNTIME_KEY]?.refreshSelection?.();
					window[RUNTIME_KEY]?.refreshMessageNav?.();
					return ret;
				};
			});
		}
		updateSelectedState();
	}
	function getUserToken() {
		const raw = getPageWindow().localStorage.getItem("userToken") || "";
		try {
			const parsed = JSON.parse(raw);
			return parsed.value || parsed.token || raw;
		} catch (e) {
			return raw;
		}
	}
	function pageFetch(url, options) {
		const win = getPageWindow();
		return (win && win.fetch ? win.fetch : fetch).call(win || void 0, url, options);
	}
	async function fetchServerTitle(chatId) {
		const token = getUserToken();
		if (!token) return null;
		const res = await pageFetch("/api/v0/chat_session/fetch_page?count=100", { headers: { "Authorization": "Bearer " + token } });
		let json = null;
		try {
			json = await res.json();
		} catch (e) {
			return null;
		}
		const row = (json && json.data && json.data.biz_data && json.data.biz_data.chat_sessions || []).find((session) => session.id === chatId);
		return row ? row.title : null;
	}
	async function renameChat(chatId, fromTitle, toTitle) {
		const token = getUserToken();
		if (!token) throw new Error("未找到登录 token，请刷新页面后重试");
		const res = await pageFetch("/api/v0/chat_session/update_title", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer " + token
			},
			body: JSON.stringify({
				chat_session_id: chatId,
				title: toTitle
			})
		});
		let json = null;
		try {
			json = await res.json();
		} catch (e) {
			throw new Error("重命名接口返回异常");
		}
		if (!json || json.code !== 0) throw new Error(json && json.msg || "重命名失败");
		const appliedTitle = json.data && json.data.biz_data && json.data.biz_data.title || toTitle;
		applyTitleOverride(chatId, fromTitle, appliedTitle);
		return appliedTitle;
	}
	async function moveFolderSubtree(fromPath, toPath) {
		if (!fromPath || !toPath || fromPath === toPath) return 0;
		const moves = getOriginalAnchors().map((anchor) => {
			if (!isAnchorPinned(anchor)) return null;
			const title = getChatTitle(anchor);
			const parsed = parseChatPath(title);
			if (!parsed) return null;
			const path = parsed.folderPath.join("/");
			if (!(path === fromPath || path.startsWith(fromPath + "/"))) return null;
			return {
				chatId: getChatIdFromHref(anchor),
				title,
				rest: [path.slice(fromPath.length + 1), parsed.chatName].filter(Boolean).join("/")
			};
		}).filter(Boolean);
		for (const move of moves) {
			const newTitle = toPath + "/" + move.rest;
			if (newTitle !== move.title) await renameChat(move.chatId, move.title, newTitle);
		}
		renameExtraFolders(fromPath, toPath);
		return moves.length;
	}
	var NEW_FOLDER_BUTTON_ID = "dscf-new-folder";
	var NEW_FOLDER_ROW_ID = "dscf-new-folder-row";
	var NEW_FOLDER_DEFAULT_NAME = "新文件夹";
	function nodeHasChats(node) {
		if (node.chats.length) return true;
		for (const child of node.children.values()) if (nodeHasChats(child)) return true;
		return false;
	}
	function expandAncestors(path) {
		const segments = path.split("/");
		for (let i = 1; i < segments.length; i++) setExpanded(segments.slice(0, i).join("/"), true);
	}
	function folderExists(path) {
		if (hasExtraFolder(path)) return true;
		return getOriginalAnchors().some((anchor) => {
			if (!isAnchorPinned(anchor)) return false;
			const parsed = parseChatPath(getChatTitle(anchor));
			if (!parsed) return false;
			const folder = parsed.folderPath.join("/");
			return folder === path || folder.startsWith(path + "/");
		});
	}
	function getPinnedListParent(anchors = getOriginalAnchors()) {
		const pinnedSection = getPinnedSection();
		if (!pinnedSection) return null;
		const first = anchors.find((anchor) => pinnedSection.contains(anchor) && anchor.parentElement);
		return first ? first.parentElement : pinnedSection.querySelector("._62cad32");
	}
	function focusNewFolderInput() {
		const input = document.querySelector("#dscf-new-folder-row input");
		if (!input) return;
		input.focus();
		input.select();
	}
	function finishNewFolder(row, state, input, onToggle, commit) {
		if (runtime.newFolder !== state) return;
		runtime.newFolder = null;
		if (commit) {
			const path = normalizeFolderPath(input.value);
			if (path) {
				if (folderExists(path)) {
					expandAncestors(path);
					setExpanded(path, true);
				} else {
					addExtraFolder(path);
					expandAncestors(path);
				}
			}
		}
		row.remove();
		if (onToggle) onToggle();
	}
	function createNewFolderRow(onToggle) {
		const state = runtime.newFolder;
		const row = document.createElement("div");
		row.id = NEW_FOLDER_ROW_ID;
		row.className = "dscf-new-folder-row";
		const anchorClass = getAnchorClass();
		if (anchorClass) row.classList.add(anchorClass);
		row.style.paddingLeft = "12px";
		const input = document.createElement("input");
		input.className = "dscf-new-folder-input";
		input.type = "text";
		input.placeholder = "文件夹名称";
		input.setAttribute("aria-label", "文件夹名称");
		input.value = state.draft || "";
		row.appendChild(input);
		input.addEventListener("input", () => {
			if (runtime.newFolder === state) runtime.newFolder.draft = input.value;
		});
		input.addEventListener("keydown", (e) => {
			if (e.isComposing || e.keyCode === 229) return;
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				finishNewFolder(row, state, input, onToggle, true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				finishNewFolder(row, state, input, onToggle, false);
			}
		});
		input.addEventListener("blur", () => finishNewFolder(row, state, input, onToggle, true));
		return row;
	}
	function startNewFolder(onToggle) {
		if (runtime.newFolder) {
			focusNewFolderInput();
			return;
		}
		runtime.newFolder = { draft: NEW_FOLDER_DEFAULT_NAME };
		if (onToggle) onToggle();
		focusNewFolderInput();
	}
	function syncNewFolderEditor(onToggle) {
		const existing = document.getElementById(NEW_FOLDER_ROW_ID);
		if (!runtime.newFolder) {
			if (existing) existing.remove();
			return false;
		}
		const parent = getPinnedListParent();
		if (!parent) {
			runtime.newFolder = null;
			if (existing) existing.remove();
			return false;
		}
		if (existing && existing.parentElement === parent) return false;
		if (existing) existing.remove();
		parent.appendChild(createNewFolderRow(onToggle));
		return true;
	}
	function disposeNewFolderEditor() {
		runtime.newFolder = null;
		document.getElementById(NEW_FOLDER_ROW_ID)?.remove();
	}
	function syncNewFolderButton(onToggle) {
		const pinnedSection = getPinnedSection();
		const existing = document.getElementById(NEW_FOLDER_BUTTON_ID);
		if (!pinnedSection) {
			if (existing) existing.remove();
			return;
		}
		const header = Array.from(pinnedSection.children).find((el) => !el.querySelector("a[href^=\"/a/chat/s/\"]") && /^(置顶|Pinned)/.test((el.textContent || "").trim()));
		if (!header) return;
		if (existing && existing.parentElement === header) return;
		if (existing) existing.remove();
		const button = document.createElement("button");
		button.id = NEW_FOLDER_BUTTON_ID;
		button.type = "button";
		button.className = "dscf-new-folder";
		button.title = "新建文件夹";
		button.setAttribute("aria-label", "新建文件夹");
		button.innerHTML = "<i class=\"fa-solid fa-plus\"></i>";
		button.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			startNewFolder(onToggle);
		});
		header.appendChild(button);
	}
	function removeNewFolderButton() {
		document.getElementById(NEW_FOLDER_BUTTON_ID)?.remove();
	}
	function startFolderRename(path, name, onToggle) {
		if (runtime.moving) return;
		runtime.folderRename = {
			path,
			draft: name,
			focusPending: true
		};
		if (onToggle) onToggle();
	}
	async function finishFolderRename(path, value, onToggle, commit) {
		const state = runtime.folderRename;
		if (!state || state.path !== path) return;
		runtime.folderRename = null;
		const parent = path.split("/").slice(0, -1).join("/");
		const name = normalizeFolderPath(value);
		const toPath = parent ? parent + "/" + name : name;
		if (!commit || !toPath || toPath === path || toPath.startsWith(path + "/")) {
			onToggle();
			return;
		}
		runtime.moving = true;
		try {
			await moveFolderSubtree(path, toPath);
			renameExpandedFolders(path, toPath);
			expandAncestors(toPath);
			setExpanded(toPath, true);
		} catch (err) {
			console.error("DeepSeek 工具箱：重命名文件夹失败", err);
			alert("重命名失败：" + (err && err.message ? err.message : err));
		} finally {
			runtime.moving = false;
			onToggle();
		}
	}
	function focusFolderRenameInput() {
		const state = runtime.folderRename;
		const input = document.querySelector(".dscf-folder-rename-input");
		if (!state || !input) return;
		input.focus();
		if (state.focusPending) {
			state.focusPending = false;
			input.select();
		} else {
			const end = input.value.length;
			input.setSelectionRange(end, end);
		}
	}
	function createFolderRenameInput(node, state, onToggle) {
		const input = document.createElement("input");
		input.className = "dscf-new-folder-input dscf-folder-rename-input";
		input.type = "text";
		input.value = state.draft;
		input.setAttribute("aria-label", "重命名文件夹");
		input.addEventListener("input", () => {
			state.draft = input.value;
		});
		input.addEventListener("click", (e) => e.stopPropagation());
		input.addEventListener("keydown", (e) => {
			if (e.isComposing || e.keyCode === 229) return;
			if (e.key === "Enter") {
				e.preventDefault();
				e.stopPropagation();
				finishFolderRename(node.path, input.value, onToggle, true);
			} else if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				finishFolderRename(node.path, input.value, onToggle, false);
			}
		});
		input.addEventListener("blur", () => finishFolderRename(node.path, input.value, onToggle, true));
		return input;
	}
	function disposeFolderRename() {
		runtime.folderRename = null;
	}
	function createFolderRow(node, depth, expanded, onToggle, deletable) {
		const row = document.createElement("div");
		const anchorClass = getAnchorClass();
		if (anchorClass) row.classList.add(anchorClass);
		row.classList.add("dscf-folder-row");
		if (expanded) row.classList.add("dscf-folder-open");
		row.dataset.path = node.path;
		row.title = node.path;
		row.style.paddingLeft = 12 + depth * 14 + "px";
		row.setAttribute("role", "button");
		row.setAttribute("aria-expanded", String(expanded));
		row.tabIndex = 0;
		row.draggable = true;
		const renameState = runtime.folderRename && runtime.folderRename.path === node.path ? runtime.folderRename : null;
		if (renameState) {
			row.classList.add("dscf-folder-renaming");
			row.draggable = false;
			row.tabIndex = -1;
			row.removeAttribute("role");
			row.removeAttribute("aria-expanded");
			row.appendChild(createFolderRenameInput(node, renameState, onToggle));
			return row;
		}
		const name = document.createElement("span");
		name.classList.add("dscf-folder-name");
		name.textContent = node.name;
		row.appendChild(name);
		const rename = document.createElement("button");
		rename.type = "button";
		rename.className = "dscf-folder-rename";
		rename.title = "重命名文件夹";
		rename.setAttribute("aria-label", "重命名文件夹");
		rename.draggable = false;
		rename.innerHTML = "<i class=\"fa-solid fa-pen\"></i>";
		rename.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			startFolderRename(node.path, node.name, onToggle);
		});
		row.appendChild(rename);
		if (deletable) {
			const remove = document.createElement("button");
			remove.type = "button";
			remove.className = "dscf-folder-remove";
			remove.title = "删除空文件夹";
			remove.setAttribute("aria-label", "删除空文件夹");
			remove.draggable = false;
			remove.innerHTML = "<i class=\"fa-solid fa-xmark\"></i>";
			remove.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				removeExtraFolder(node.path);
				onToggle();
			});
			row.appendChild(remove);
		}
		const toggle = () => {
			toggleExpanded(node.path);
			onToggle();
		};
		row.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			toggle();
		});
		row.addEventListener("keydown", (e) => {
			if (e.target !== row) return;
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				toggle();
			}
		});
		return row;
	}
	function renderParent(parent, chats, onToggle, extraFolders = [], extraSet = new Set()) {
		parent.classList.add("dscf-list-parent");
		const chatByAnchor = new Map();
		chats.forEach((chat) => chatByAnchor.set(chat.anchor, chat));
		const root = buildTree(chats, extraFolders);
		const originalChildren = Array.from(parent.children);
		let order = 0;
		const emitTree = () => {
			const walk = (node, depth, parentVisible) => {
				const expanded = isExpanded(node.path);
				const row = createFolderRow(node, depth, expanded, onToggle, extraSet.has(node.path) && !nodeHasChats(node));
				row.style.order = String(order++);
				if (!parentVisible) setSubtreeHidden(row, true);
				parent.appendChild(row);
				const childVisible = parentVisible && expanded;
				Array.from(node.children.values()).sort(compareFolder).forEach((child) => {
					walk(child, depth + 1, childVisible);
				});
				node.chats.slice().sort((a, b) => compareName(a.chatName, b.chatName)).forEach((chat) => {
					const anchor = chat.anchor;
					markChatRow(anchor, true);
					anchor.style.order = String(order++);
					anchor.style.paddingLeft = 12 + (depth + 1) * 14 + "px";
					setSubtreeHidden(anchor, !childVisible);
				});
			};
			Array.from(root.children.values()).sort(compareFolder).forEach((node) => walk(node, 0, true));
		};
		emitTree();
		const newFolderRow = document.getElementById(NEW_FOLDER_ROW_ID);
		if (newFolderRow && newFolderRow.parentElement === parent && runtime.newFolder) newFolderRow.style.order = String(order++);
		originalChildren.forEach((child) => {
			if (chatByAnchor.has(child)) return;
			if (child === newFolderRow) return;
			child.style.order = String(order++);
		});
	}
	function cleanupInPlace() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		scrollArea.querySelectorAll(".dscf-folder-row").forEach((row) => row.remove());
		scrollArea.querySelectorAll(".dscf-list-parent").forEach((parent) => {
			Array.from(parent.children).forEach((child) => {
				child.style.order = "";
				if (child.tagName === "A") {
					child.style.paddingLeft = "";
					markChatRow(child, false);
					setSubtreeHidden(child, false);
				}
			});
			parent.classList.remove("dscf-list-parent");
		});
		scrollArea.querySelectorAll("a[data-dscf-chat]").forEach((anchor) => {
			markChatRow(anchor, false);
			setSubtreeHidden(anchor, false);
			anchor.style.order = "";
			anchor.style.paddingLeft = "";
		});
	}
	function renderInPlace(anchors, onToggle) {
		cleanupInPlace();
		syncNewFolderButton(onToggle);
		anchors.forEach((anchor) => {
			anchor.draggable = true;
		});
		const pinnedSection = getPinnedSection();
		anchors.forEach((anchor) => {
			const fullTitle = getChatTitle(anchor);
			const parsed = parseChatPath(fullTitle);
			applyLeafTitle(anchor, fullTitle, !!pinnedSection && pinnedSection.contains(anchor) && !!parsed);
		});
		if (!pinnedSection) {
			updateSelectedState();
			return;
		}
		const firstPinned = anchors.find((anchor) => pinnedSection.contains(anchor) && anchor.parentElement);
		const pinnedParent = firstPinned ? firstPinned.parentElement : null;
		const extraFolders = getExtraFolders();
		const extraSet = new Set(extraFolders);
		const groups = new Map();
		if (pinnedParent) groups.set(pinnedParent, []);
		anchors.forEach((anchor) => {
			if (!pinnedSection.contains(anchor)) return;
			const title = getChatTitle(anchor);
			const parsed = parseChatPath(title);
			if (!parsed || !anchor.parentElement) return;
			const parent = anchor.parentElement;
			if (!groups.has(parent)) groups.set(parent, []);
			groups.get(parent).push({
				anchor,
				title,
				folderPath: parsed.folderPath,
				chatName: parsed.chatName
			});
		});
		groups.forEach((chats, parent) => {
			renderParent(parent, chats, onToggle, parent === pinnedParent ? extraFolders : [], extraSet);
		});
		focusFolderRenameInput();
		updateSelectedState();
	}
	var session = null;
	var restoring = 0;
	function isRestoringTitle() {
		return restoring > 0;
	}
	var lastChats = new Map();
	function delay(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
	function rememberChats(anchors) {
		const next = new Map();
		anchors.forEach((anchor) => {
			const chatId = getChatIdFromHref(anchor);
			if (!chatId) return;
			const stored = anchor.dataset ? anchor.dataset.dscfFullTitle : "";
			const parsed = stored ? parseChatPath(stored) : null;
			next.set(chatId, {
				fullTitle: stored || getRawTitle(anchor),
				folderPath: parsed ? parsed.folderPath : null,
				leaf: parsed ? parsed.chatName : null,
				order: anchor.style ? anchor.style.order : "",
				paddingLeft: anchor.style ? anchor.style.paddingLeft : "",
				hidden: isSubtreeHidden(anchor),
				parent: anchor.parentElement
			});
		});
		lastChats.clear();
		next.forEach((info, chatId) => lastChats.set(chatId, info));
	}
	function readEditorValue(editor) {
		return editor ? (editor.value || "").trim() : "";
	}
	function writeEditorValue(editor, value, silent = false, select = true) {
		if (!editor) return;
		const proto = Object.getPrototypeOf(editor);
		const desc = proto && Object.getOwnPropertyDescriptor(proto, "value");
		if (desc && desc.set) desc.set.call(editor, value);
		else editor.value = value;
		if (!silent) editor.dispatchEvent(new Event("input", { bubbles: true }));
		if (select && typeof editor.select === "function") editor.select();
	}
	function placeEditor(target) {
		const wrapper = target.wrapper;
		if (!wrapper) return;
		if (target.order) wrapper.style.order = target.order;
		const padding = parseInt(target.paddingLeft, 10);
		if (!Number.isNaN(padding)) wrapper.style.paddingLeft = Math.max(0, padding - 10) + "px";
		if (target.hidden) setSubtreeHidden(wrapper, true);
	}
	function fillLeafTitle(target) {
		if (session !== target || target.reverted) return;
		if (!target.folderPath || !target.leaf) return;
		const current = readEditorValue(target.editor);
		if (current === target.fullTitle) {
			writeEditorValue(target.editor, target.leaf, true);
			target.selectedOnce = true;
			return;
		}
		if (target.touched) return;
		if (!current) {
			if (target.retries < 10) {
				target.retries += 1;
				target.timer = setTimeout(() => fillLeafTitle(target), 50);
			}
			return;
		}
		if (!target.selectedOnce && current === target.leaf) {
			target.selectedOnce = true;
			if (typeof target.editor.select === "function") target.editor.select();
		}
	}
	function beginSession(editor) {
		const wrapper = editor.parentElement;
		const parent = wrapper && wrapper.parentElement;
		if (!parent) return null;
		const value = readEditorValue(editor);
		const currentIds = new Set(getOriginalAnchors().map(getChatIdFromHref).filter(Boolean));
		const entries = Array.from(lastChats.entries());
		const sameParent = entries.filter(([, info]) => info.parent === parent);
		const titleMatches = (sameParent.length ? sameParent : entries).filter(([, info]) => info.fullTitle === value || info.leaf === value);
		const byTitle = titleMatches.find(([chatId]) => !currentIds.has(chatId)) || titleMatches[0];
		const vanished = entries.filter(([chatId]) => !currentIds.has(chatId));
		const found = byTitle || (vanished.length === 1 ? vanished[0] : null);
		if (!found) return null;
		const [chatId, info] = found;
		const target = {
			chatId,
			editor,
			wrapper,
			parent,
			fullTitle: info.fullTitle,
			folderPath: info.folderPath,
			leaf: info.leaf,
			order: info.order,
			paddingLeft: info.paddingLeft,
			hidden: info.hidden,
			touched: false,
			selectedOnce: false,
			reverted: false,
			retries: 0,
			timer: null,
			prefillTimer: null,
			abort: new AbortController()
		};
		editor.addEventListener("input", (e) => {
			if (e.isTrusted) target.touched = true;
		}, { signal: target.abort.signal });
		const revertIfUnchanged = () => {
			if (session !== target || target.reverted) return;
			if (readEditorValue(target.editor) !== target.leaf) return;
			target.reverted = true;
			writeEditorValue(target.editor, target.fullTitle, true, false);
		};
		editor.addEventListener("keydown", (e) => {
			if (e.key === "Enter") revertIfUnchanged();
		}, {
			capture: true,
			signal: target.abort.signal
		});
		editor.addEventListener("focusout", revertIfUnchanged, {
			capture: true,
			signal: target.abort.signal
		});
		target.prefillTimer = setInterval(() => {
			if (session !== target || target.touched) return;
			fillLeafTitle(target);
		}, 500);
		return target;
	}
	async function waitForEditedTitle(target, timeout = 4e3) {
		const deadline = Date.now() + timeout;
		let last = "";
		let stable = 0;
		while (Date.now() < deadline) {
			if (getRenameEditor()) return "";
			const anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === target.chatId);
			if (anchor) {
				if (target.order) anchor.style.order = target.order;
				if (target.paddingLeft) anchor.style.paddingLeft = target.paddingLeft;
				if (target.hidden) setSubtreeHidden(anchor, true);
				const raw = getRawTitle(anchor);
				if (raw) {
					if (raw === last) {
						if (++stable >= 6) return raw;
					} else {
						last = raw;
						stable = 0;
					}
				}
			}
			await delay(50);
		}
		return last;
	}
	async function ensureServerTitle(chatId, expected) {
		for (let attempt = 0; attempt < 2; attempt++) {
			await delay(300);
			let current = null;
			try {
				current = await fetchServerTitle(chatId);
			} catch (err) {
				return;
			}
			if (!current || current === expected) return;
			if (parseChatPath(current)) return;
			try {
				await renameChat(chatId, current, expected);
			} catch (err) {
				console.warn("[DeepSeek 工具箱] 补写目录路径失败", err);
				return;
			}
		}
	}
	async function restoreFolderPrefix(target) {
		restoring += 1;
		try {
			if (!target.folderPath) return;
			if (getRenameEditor()) return;
			const raw = await waitForEditedTitle(target);
			if (!raw || raw === target.fullTitle) return;
			if (parseChatPath(raw)) return;
			if (raw === target.leaf) {
				let serverTitle = null;
				try {
					serverTitle = await fetchServerTitle(target.chatId);
				} catch (err) {
					serverTitle = null;
				}
				if (serverTitle === target.fullTitle) return;
			}
			const newTitle = target.folderPath.join("/") + "/" + raw;
			const anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === target.chatId);
			if (anchor && anchor.dataset) anchor.dataset.dscfFullTitle = newTitle;
			try {
				await renameChat(target.chatId, raw, newTitle);
			} catch (err) {
				console.warn("[DeepSeek 工具箱] 恢复目录路径失败", err);
				if (anchor && anchor.dataset) delete anchor.dataset.dscfFullTitle;
				return;
			}
			await ensureServerTitle(target.chatId, newTitle);
		} finally {
			restoring -= 1;
			if (!restoring) runtime.rebuild && runtime.rebuild(true);
		}
	}
	function finishSession(target) {
		if (session === target) session = null;
		if (target.timer) clearTimeout(target.timer);
		if (target.prefillTimer) clearInterval(target.prefillTimer);
		target.abort.abort();
		restoreFolderPrefix(target);
	}
	function syncRenameEditor() {
		const editor = getRenameEditor();
		if (!editor) {
			if (session) finishSession(session);
			return;
		}
		if (!session) session = beginSession(editor);
		else {
			session.editor = editor;
			session.wrapper = editor.parentElement;
		}
		if (!session) return;
		placeEditor(session);
		fillLeafTitle(session);
	}
	function disposeRenameEditor() {
		if (!session) return;
		if (session.timer) clearTimeout(session.timer);
		if (session.prefillTimer) clearInterval(session.prefillTimer);
		session.abort.abort();
		session = null;
	}
	var anchorKeys = new WeakMap();
	var anchorKeySeq = 0;
	function getAnchorKey(anchor) {
		let key = anchorKeys.get(anchor);
		if (!key) {
			key = "a" + ++anchorKeySeq;
			anchorKeys.set(anchor, key);
		}
		return key;
	}
	function makeSignature$1(anchors) {
		const parents = [];
		return anchors.map((anchor) => {
			let parentIndex = parents.indexOf(anchor.parentElement);
			if (parentIndex === -1) {
				parentIndex = parents.length;
				parents.push(anchor.parentElement);
			}
			return parentIndex + ":" + getAnchorKey(anchor) + ":" + getChatTitle(anchor);
		}).join("\n");
	}
	var lastSignature = null;
	function rebuild(force = false) {
		if (!getScrollArea()) return;
		syncNewFolderButton(() => rebuild(true));
		const editorRecreated = syncNewFolderEditor(() => rebuild(true));
		if (getRenameEditor() || isRestoringTitle()) return;
		const anchors = getOriginalAnchors();
		syncTitleOverrides(anchors);
		detectUnpinnedFolderRename(anchors);
		const signature = makeSignature$1(anchors);
		if (!force && !editorRecreated && signature === lastSignature) return;
		lastSignature = signature;
		renderInPlace(anchors, () => rebuild(true));
		rememberChats(getOriginalAnchors());
	}
	function observeChatList() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		const schedule = () => {
			syncRenameEditor();
			clearTimeout(runtime.timer);
			runtime.timer = setTimeout(() => rebuild(), 150);
		};
		const observer = new MutationObserver(schedule);
		runtime.observer = observer;
		observer.observe(scrollArea, {
			childList: true,
			subtree: true,
			characterData: true
		});
	}
	function resolveDropTarget(node) {
		const row = node && node.closest ? node.closest(".dscf-folder-row") : null;
		if (row) return {
			type: "folder",
			path: row.dataset.path,
			element: row
		};
		const anchor = node && node.closest ? node.closest("a[href^=\"/a/chat/s/\"]") : null;
		if (anchor) {
			const parsed = parseChatPath(getChatTitle(anchor));
			return {
				type: "chat",
				path: parsed && isAnchorPinned(anchor) ? parsed.folderPath.join("/") : "",
				element: anchor
			};
		}
		return {
			type: "root",
			path: "",
			element: getScrollArea()
		};
	}
	function canDrop(drag, target) {
		if (!drag || !target) return false;
		if (drag.type === "chat") return target.path !== (drag.folderPath || "");
		if (!target.path) return drag.path.includes("/");
		if (target.path === drag.path || target.path.startsWith(drag.path + "/")) return false;
		if (drag.path.startsWith(target.path + "/")) return false;
		return true;
	}
	function clearDropHighlight() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		scrollArea.classList.remove("dscf-drop-root");
		scrollArea.querySelectorAll(".dscf-drop-target").forEach((el) => {
			el.classList.remove("dscf-drop-target");
		});
		runtime.dropKey = null;
	}
	function highlightDropTarget(target) {
		const key = target.type + ":" + target.path;
		const scrollArea = getScrollArea();
		const already = target.type === "root" ? !!scrollArea && scrollArea.classList.contains("dscf-drop-root") : !!target.element && target.element.classList.contains("dscf-drop-target");
		if (runtime.dropKey === key && already) return;
		clearDropHighlight();
		runtime.dropKey = key;
		if (target.type === "root") {
			if (scrollArea) scrollArea.classList.add("dscf-drop-root");
		} else if (target.element) target.element.classList.add("dscf-drop-target");
	}
	async function handleDrop(drag, target) {
		if (runtime.moving) return;
		runtime.moving = true;
		const scrollArea = getScrollArea();
		if (scrollArea) scrollArea.classList.add("dscf-moving");
		try {
			if (drag.type === "chat") {
				let anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === drag.chatId);
				if (!anchor) return;
				if (!isAnchorPinned(anchor)) {
					if (!await pinChatByMenu(drag.chatId)) throw new Error("置顶失败，无法放入目录（可能已达置顶上限）");
					anchor = getOriginalAnchors().find((a) => getChatIdFromHref(a) === drag.chatId) || anchor;
				}
				const title = getChatTitle(anchor);
				const parsed = parseChatPath(title);
				const leaf = parsed ? parsed.chatName : title;
				const newTitle = target.path ? target.path + "/" + leaf : leaf;
				if (newTitle !== title) await renameChat(drag.chatId, title, newTitle);
				dropExtraFolderChain(target.path);
				return;
			}
			const base = target.path ? target.path + "/" + drag.name : drag.name;
			await moveFolderSubtree(drag.path, base);
			dropExtraFolderChain(target.path);
		} catch (err) {
			console.error("DeepSeek 工具箱：移动失败", err);
			alert("移动失败：" + (err && err.message ? err.message : err));
		} finally {
			runtime.moving = false;
			if (scrollArea) scrollArea.classList.remove("dscf-moving");
			rebuild(true);
		}
	}
	function initDragAndDrop() {
		const scrollArea = getScrollArea();
		if (!scrollArea) return;
		const abort = new AbortController();
		runtime.dragAbort = abort;
		scrollArea.addEventListener("dragstart", (e) => {
			const row = e.target.closest ? e.target.closest(".dscf-folder-row") : null;
			const anchor = e.target.closest ? e.target.closest("a[href^=\"/a/chat/s/\"]") : null;
			if (row) {
				const path = row.dataset.path;
				runtime.drag = {
					type: "folder",
					path,
					name: path.split("/").pop()
				};
			} else if (anchor) {
				const title = getChatTitle(anchor);
				const parsed = parseChatPath(title);
				const pinned = isAnchorPinned(anchor);
				runtime.drag = {
					type: "chat",
					chatId: getChatIdFromHref(anchor),
					title,
					pinned,
					folderPath: pinned && parsed ? parsed.folderPath.join("/") : ""
				};
			} else return;
			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = "move";
				e.dataTransfer.setData("text/plain", runtime.drag.type);
			}
		}, { signal: abort.signal });
		scrollArea.addEventListener("dragover", (e) => {
			if (!runtime.drag || runtime.moving) return;
			const target = resolveDropTarget(e.target);
			if (!canDrop(runtime.drag, target)) {
				clearDropHighlight();
				return;
			}
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
			highlightDropTarget(target);
		}, { signal: abort.signal });
		scrollArea.addEventListener("dragleave", (e) => {
			if (!scrollArea.contains(e.relatedTarget)) clearDropHighlight();
		}, { signal: abort.signal });
		scrollArea.addEventListener("drop", (e) => {
			if (!runtime.drag || runtime.moving) return;
			const target = resolveDropTarget(e.target);
			if (!canDrop(runtime.drag, target)) {
				clearDropHighlight();
				return;
			}
			e.preventDefault();
			const drag = runtime.drag;
			runtime.drag = null;
			clearDropHighlight();
			handleDrop(drag, target);
		}, { signal: abort.signal });
		scrollArea.addEventListener("dragend", () => {
			runtime.drag = null;
			clearDropHighlight();
		}, { signal: abort.signal });
	}
	var CDN_BASE = `https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib`;
	var STYLE_ID = "dscf-katex-copy-style";
	var SCRIPT_ID = "dscf-katex-copy-script";
	function initKatexCopy() {
		document.getElementById(STYLE_ID)?.remove();
		document.getElementById(SCRIPT_ID)?.remove();
		const link = document.createElement("link");
		link.id = STYLE_ID;
		link.rel = "stylesheet";
		link.href = `${CDN_BASE}/copy-tex.min.css`;
		document.head.appendChild(link);
		const script = document.createElement("script");
		script.id = SCRIPT_ID;
		script.src = `${CDN_BASE}/copy-tex.min.js`;
		script.defer = true;
		document.head.appendChild(script);
	}
	var NAV_ATTR = "data-dscf-msgnav";
	var FLASH_MS = 600;
	var NAV_EDGE = 16;
	var MIN_ENTRIES = 1;
	var KEY_ATTRS = [
		"data-virtual-list-item-key",
		"data-message-id",
		"data-chatgpt-search-unit-key"
	];
	var identity = createIdentity();
	function createIdentity() {
		return {
			nextId: 0,
			byEl: new WeakMap()
		};
	}
	function deepseekAnswerRoots(el) {
		const body = el.querySelector(".ds-assistant-message-main-content");
		if (body) return [body];
		return Array.from(el.querySelectorAll(".ds-markdown")).filter((node) => !node.parentElement.closest(".ds-markdown") && !node.closest(".ds-think-content"));
	}
	var SITE_ADAPTERS = [
		{
			hosts: ["chatgpt.com", "chat.openai.com"],
			selector: "[data-message-author-role], [data-chatgpt-search-unit-key]",
			role: (el) => {
				const author = el.getAttribute("data-message-author-role");
				if (author) return author === "user" ? "USER" : "ASSISTANT";
				return /:user$/.test(el.getAttribute("data-chatgpt-search-unit-key") || "") ? "USER" : "ASSISTANT";
			},
			bubble: (el) => el.querySelector(".bg-user-message") || el.querySelector("[data-message-author-role=\"user\"]"),
			scroller: "main"
		},
		{
			hosts: ["gemini.google.com"],
			selector: "user-query, model-response",
			role: (el) => el.tagName.toLowerCase() === "user-query" ? "USER" : "ASSISTANT",
			content: (el) => el.querySelector("div.query-content") || el.querySelector(".query-text") || el.querySelector("message-content") || el,
			bubble: (el) => el.querySelector(".user-query-bubble-with-background") || el.querySelector("div.query-text") || el.querySelector("div.query-content"),
			scroller: "infinite-scroller, #chat-history"
		},
		{
			hosts: ["grok.com"],
			selector: "div[id^='response-']",
			role: (el) => el.querySelector("[data-testid=\"user-message\"]") ? "USER" : "ASSISTANT",
			content: (el) => el.querySelector(".response-content-markdown") || el.querySelector("[data-bubble-text]") || el,
			bubble: (el) => el.querySelector("[data-testid=\"user-message\"]"),
			scroller: "main"
		},
		{
			hosts: ["chat.deepseek.com"],
			selector: "[data-virtual-list-item-key]",
			role: (el) => el.querySelector(".ds-markdown") ? "ASSISTANT" : "USER",
			content: (el) => deepseekAnswerRoots(el)[0] || el.querySelector(".ds-message") || el,
			bubble: (el) => Array.from(el.querySelectorAll(".ds-message > div")).find((node) => (node.innerText || "").trim()),
			replyAnchor: (el) => {
				const [root] = deepseekAnswerRoots(el);
				return root && (root.firstElementChild || root);
			},
			replyBubble: (el) => deepseekAnswerRoots(el)[0] || null,
			scroller: ".ds-scroll-area"
		},
		{
			hosts: ["sichang.xyz"],
			selector: ".chat-message-markdown, .chat-message-copy",
			role: (el) => {
				if (el.closest("[class*=\"bg-bubble-assistant\"]")) return "ASSISTANT";
				if (el.closest("[class*=\"bg-bubble-user\"]")) return "USER";
				return el.classList.contains("chat-message-markdown") ? "ASSISTANT" : "USER";
			},
			content: (el) => el,
			bubble: (el) => el.closest("[class*=\"bg-bubble-\"]"),
			scroller: "[data-slot=\"scroll-area-viewport\"]"
		},
		{
			hosts: ["venice.ai"],
			selector: ".minds-chat-scroll-root [role=\"group\"], .minds-chat-scroll-root .assistant, [data-message-id]",
			role: (el) => {
				if (el.matches(".assistant") || el.querySelector(".assistant")) return "ASSISTANT";
				const box = el.querySelector("[data-message-content]");
				return box && box.getAttribute("data-role") === "assistant" ? "ASSISTANT" : "USER";
			},
			content: (el) => el.querySelector(".assistant") || el.querySelector("[data-testid=\"user-message\"]") || el.querySelector("[data-message-content=\"true\"]") || el.querySelector(".assistant-content") || el,
			bubble: (el) => el.querySelector(".assistant") || el.querySelector("[data-testid=\"user-message\"]") || el.querySelector(".assistant-content"),
			scroller: scrollableAncestor
		}
	];
	function scrollableAncestor(el) {
		for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) if (/(auto|scroll)/.test(getComputedStyle(node).overflowY)) return node;
		return null;
	}
	var FALLBACK_SELECTOR = [
		"[data-message-author-role]",
		"user-query",
		"model-response",
		"message-content",
		"article"
	].join(",");
	var ADAPTER = resolveAdapter();
	function resolveAdapter() {
		const host = location.hostname;
		return SITE_ADAPTERS.find((adapter) => adapter.hosts.some((h) => host === h || host.endsWith("." + h))) || null;
	}
	var state = {
		scroller: null,
		topInset: 0,
		entries: [],
		items: [],
		itemsByKey: new Map(),
		signature: "",
		root: null,
		list: null,
		rows: [],
		rowsByKey: new Map(),
		activeKey: null,
		observer: null,
		onScroll: null,
		historyTimer: null,
		href: location.href,
		refreshTimer: null,
		watchTimer: null,
		halo: null,
		haloToken: 0,
		jumpLocked: false,
		awaitScroll: false,
		onIntent: null,
		answerPreview: new Set(),
		answerReply: new Map(),
		dismissed: false,
		shown: false,
		position: null,
		drag: null,
		flyTimer: null,
		card: null,
		bar: null
	};
	function readText(el) {
		const clone = (ADAPTER && ADAPTER.content ? ADAPTER.content(el) : el).cloneNode(true);
		clone.querySelectorAll("button, svg, [aria-hidden=\"true\"], nav, form, .sr-only, .cdk-visually-hidden, .ds-think-content").forEach((node) => node.remove());
		return (clone.textContent || "").replace(/\s+/g, " ").trim();
	}
	function detectRole(el, index) {
		const role = ADAPTER && ADAPTER.role ? ADAPTER.role(el) : null;
		if (role) return role;
		const author = el.getAttribute("data-message-author-role");
		if (author === "user") return "USER";
		if (author === "assistant") return "ASSISTANT";
		const tag = el.tagName.toLowerCase();
		if (tag === "user-query") return "USER";
		if (tag === "model-response") return "ASSISTANT";
		return index % 2 === 0 ? "USER" : "ASSISTANT";
	}
	function dropNested(nodes) {
		const matched = new Set(nodes);
		return nodes.filter((el) => {
			for (let parent = el.parentElement; parent; parent = parent.parentElement) if (matched.has(parent)) return false;
			return true;
		});
	}
	function getMessageBlocks() {
		const selector = ADAPTER && ADAPTER.selector || FALLBACK_SELECTOR;
		return dropNested(Array.from(document.querySelectorAll(selector)).filter((el) => el.getClientRects().length > 0));
	}
	function hintScroller(block) {
		if (!ADAPTER || !ADAPTER.scroller) return null;
		return typeof ADAPTER.scroller === "function" ? ADAPTER.scroller(block) : block.closest(ADAPTER.scroller);
	}
	function resolveScroller(blocks) {
		if (!blocks.length) return null;
		const hinted = hintScroller(blocks[0]);
		if (hinted) return hinted;
		let best = null;
		let bestHeight = 0;
		let node = blocks[0]?.parentElement;
		while (node && node !== document.body) {
			const style = getComputedStyle(node);
			if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 40) {
				if (blocks.filter((block) => node.contains(block)).length >= 2 && node.scrollHeight > bestHeight) {
					best = node;
					bestHeight = node.scrollHeight;
				}
			}
			node = node.parentElement;
		}
		return best || Array.from(document.querySelectorAll("*")).filter((el) => {
			const style = getComputedStyle(el);
			return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 200 && blocks.some((block) => el.contains(block));
		}).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
	}
	function attrKey(el) {
		for (const attr of KEY_ATTRS) {
			const value = el.getAttribute(attr);
			if (value) return "k:" + attr + ":" + value;
		}
		return null;
	}
	function readPass() {
		return getMessageBlocks().map((el, index) => {
			const role = detectRole(el, index);
			const text = readText(el);
			const attr = attrKey(el);
			const known = identity.byEl.get(el);
			if (attr && known && known !== attr) {
				const stale = state.itemsByKey.get(known);
				if (stale) stale.el = null;
			}
			return {
				el,
				role,
				text,
				key: attr || known || null
			};
		});
	}
	function mergePass(blocks) {
		const claimed = new Set(blocks.map((block) => block.key).filter(Boolean));
		let cursor = 0;
		for (const block of blocks) {
			if (!block.key) {
				const landed = findRemembered(block, claimed, cursor);
				if (landed) {
					block.key = landed.key;
					cursor = landed.index + 1;
				} else block.key = "i:" + (identity.nextId += 1);
			}
			claimed.add(block.key);
			identity.byEl.set(block.el, block.key);
		}
		const fresh = blocks.map(({ key, role, text, el }) => ({
			key,
			role,
			text,
			el
		}));
		const order = mergeOrder(fresh.map((item) => item.key));
		const freshByKey = new Map(fresh.map((item) => [item.key, item]));
		const items = order.map((key) => freshByKey.get(key) || state.itemsByKey.get(key)).filter(Boolean);
		state.items = items;
		state.itemsByKey = new Map(items.map((item) => [item.key, item]));
		state.entries = groupEntries(items);
		return state.entries;
	}
	function findRemembered(block, claimed, from) {
		for (let index = from; index < state.items.length; index += 1) {
			const item = state.items[index];
			if (claimed.has(item.key) || item.role !== block.role || item.text !== block.text) continue;
			return {
				key: item.key,
				index
			};
		}
		return null;
	}
	function mergeOrder(freshKeys) {
		const order = state.items.map((item) => item.key);
		const atByKey = new Map(order.map((key, index) => [key, index]));
		freshKeys.forEach((key, freshIndex) => {
			if (atByKey.has(key)) return;
			let at = -1;
			for (let i = freshIndex - 1; i >= 0 && at < 0; i -= 1) {
				const hit = atByKey.get(freshKeys[i]);
				if (hit !== void 0) at = hit + 1;
			}
			for (let i = freshIndex + 1; i < freshKeys.length && at < 0; i += 1) {
				const hit = atByKey.get(freshKeys[i]);
				if (hit !== void 0) at = hit;
			}
			if (at < 0) at = order.length;
			order.splice(at, 0, key);
			for (let i = at; i < order.length; i += 1) atByKey.set(order[i], i);
		});
		return order;
	}
	function groupEntries(items) {
		const entries = [];
		let current = null;
		for (const item of items) if (isUserEntry(item)) {
			current = {
				...item,
				replies: []
			};
			entries.push(current);
		} else if (current) current.replies.push(item);
		return entries;
	}
	function makeSignature(entries) {
		return entries.map((entry) => entry.key + ":" + entry.replies.map((reply) => reply.key).join(",") + ":" + entry.text.slice(0, 12)).join("|");
	}
	function isUserEntry(entry) {
		return entry.role === "USER";
	}
	function findBlock(item) {
		if (item.el && item.el.isConnected) return item.el;
		const block = item.key ? getMessageBlocks().find((el) => (attrKey(el) || identity.byEl.get(el)) === item.key) : null;
		if (block) item.el = block;
		return block || null;
	}
	function selectedReply(entry) {
		if (!entry.replies.length) return null;
		const key = state.answerReply.get(entry.key);
		return entry.replies.find((reply) => reply.key === key) || entry.replies[0];
	}
	var ACTIVE_LINE_OFFSET = 20;
	var SCROLL_KEYS = /^(PageUp|PageDown|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End| |Spacebar)$/;
	function readTopInset(scroller, blocks) {
		if (!blocks.length) return ACTIVE_LINE_OFFSET;
		const inset = blocks[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
		return (inset > 0 && inset < 200 ? inset : 0) + ACTIVE_LINE_OFFSET;
	}
	function scrollParentOf(el) {
		for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
			const { overflowY } = getComputedStyle(node);
			if (/(auto|scroll)/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
		}
		return null;
	}
	function jumpTo(entry) {
		jumpToKey(entry.key, entry.el, entry.key);
	}
	function jumpToReply(entry) {
		const reply = selectedReply(entry);
		if (!reply) return;
		jumpToKey(reply.key, reply.el, entry.key, true);
	}
	function jumpToKey(key, el, activeKey, reply = false, retry = true) {
		const block = el && el.isConnected ? el : findBlock({
			key,
			el
		});
		if (!block) {
			if (retry) jumpToUnmounted(key, activeKey, reply);
			return;
		}
		const target = (reply && ADAPTER && ADAPTER.replyAnchor ? ADAPTER.replyAnchor(block) : null) || block;
		const scroller = state.scroller && state.scroller.contains(target) ? state.scroller : scrollParentOf(target);
		const height = target.getBoundingClientRect().height;
		lockActiveOnJump();
		const view = scroller ? scroller.clientHeight : window.innerHeight;
		const inset = height < view ? (view - height) / 2 : view / 2;
		if (scroller) {
			const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop + scroller.scrollTop;
			const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
			scroller.scrollTop = Math.min(Math.max(0, top - inset), max);
		} else {
			target.scrollIntoView({ block: "start" });
			window.scrollBy(0, -inset);
		}
		flashEntry(target, (reply && ADAPTER && ADAPTER.replyBubble ? ADAPTER.replyBubble(block) : null) || (target !== block ? target : null));
		setActive(activeKey);
	}
	function jumpToUnmounted(key, activeKey, reply) {
		const scroller = state.scroller;
		const index = state.items.findIndex((item) => item.key === key);
		if (!scroller || index < 0) return;
		lockActiveOnJump();
		const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
		scroller.scrollTop = state.items.length > 1 ? index / (state.items.length - 1) * max : 0;
		setActive(activeKey);
		setTimeout(() => {
			const item = state.itemsByKey.get(key);
			const block = item && findBlock(item);
			if (block) jumpToKey(key, block, activeKey, reply, false);
		}, 400);
	}
	function roundedImageBox(block) {
		const img = block.querySelector("img");
		if (!img) return null;
		for (let node = img.parentElement; node && node !== block; node = node.parentElement) if (parseFloat(getComputedStyle(node).borderTopLeftRadius) > 0) return node;
		return img.parentElement;
	}
	function ensureHalo() {
		if (state.halo && state.halo.isConnected) return state.halo;
		const halo = document.createElement("div");
		halo.className = "dscf-halo";
		halo.setAttribute("aria-hidden", "true");
		document.body.appendChild(halo);
		state.halo = halo;
		return halo;
	}
	function flashEntry(block, exact = null) {
		const bubble = exact || (ADAPTER && ADAPTER.bubble ? ADAPTER.bubble(block) : null) || roundedImageBox(block) || block;
		const halo = ensureHalo();
		const radius = getComputedStyle(bubble).borderRadius;
		const place = () => {
			const rect = bubble.getBoundingClientRect();
			halo.style.left = `${rect.left}px`;
			halo.style.top = `${rect.top}px`;
			halo.style.width = `${rect.width}px`;
			halo.style.height = `${rect.height}px`;
			halo.style.borderRadius = radius;
		};
		const token = state.haloToken += 1;
		place();
		halo.getAnimations().forEach((animation) => animation.cancel());
		const fade = halo.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: FLASH_MS,
			easing: "ease-out"
		});
		setTimeout(() => fade.cancel(), 800);
		const follow = () => {
			if (token !== state.haloToken || fade.playState !== "running") return;
			if (!bubble.isConnected) {
				fade.cancel();
				return;
			}
			place();
			requestAnimationFrame(follow);
		};
		requestAnimationFrame(follow);
	}
	function lockActiveOnJump() {
		state.jumpLocked = true;
		state.awaitScroll = false;
	}
	function markScrollIntent(event) {
		if (!state.jumpLocked) return;
		if (event && event.type === "keydown") {
			const target = event.target;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "")) || !SCROLL_KEYS.test(event.key)) return;
		}
		state.awaitScroll = true;
	}
	function onScroll() {
		if (state.awaitScroll) {
			state.awaitScroll = false;
			state.jumpLocked = false;
		}
		updateActive();
	}
	function updateActive() {
		if (!state.entries.length || !state.scroller || state.jumpLocked) return;
		const limit = state.scroller.getBoundingClientRect().top + state.topInset + 1;
		let key = state.entries[0].key;
		for (const entry of state.entries) {
			const candidates = entry.replies.length > 1 ? [entry, ...entry.replies] : [entry];
			for (const item of candidates) {
				const block = item.el && item.el.isConnected ? item.el : null;
				if (block && block.getBoundingClientRect().top <= limit) key = item.key;
			}
		}
		setActive(key);
	}
	function setActive(key) {
		if (state.activeKey === key) return;
		state.activeKey = key;
		state.rows.forEach((row) => {
			const active = row.dataset.key === key;
			row.classList.toggle("is-active", active);
			const entry = state.entries.find((item) => item.key === row.dataset.key);
			const jump = row.querySelector(".dscf-msgnav-jump");
			if (entry && jump) jump.setAttribute("aria-label", jumpActionLabel(entry, row.classList.contains("is-showing-answer"), active));
			if (active && state.root && state.root.matches(":hover")) row.scrollIntoView({ block: "nearest" });
		});
	}
	function ensureDom() {
		if (state.root) return;
		const root = document.createElement("div");
		root.className = "dscf-msgnav";
		root.setAttribute(NAV_ATTR, "1");
		const card = document.createElement("div");
		card.className = "dscf-msgnav-list";
		const bar = document.createElement("div");
		bar.className = "dscf-msgnav-bar";
		const grip = document.createElement("span");
		grip.className = "dscf-msgnav-grip";
		grip.innerHTML = GRIP_ICON;
		const close = document.createElement("button");
		close.type = "button";
		close.className = "dscf-msgnav-close";
		close.title = "临时隐藏（刷新后恢复）";
		close.setAttribute("aria-label", close.title);
		close.innerHTML = CLOSE_ICON;
		close.addEventListener("click", () => {
			state.dismissed = true;
			syncVisibility();
		});
		bar.append(grip, close);
		bar.addEventListener("pointerdown", startNavDrag);
		const items = document.createElement("div");
		items.className = "dscf-msgnav-items";
		card.append(bar, items);
		root.append(card);
		document.body.appendChild(root);
		if (window.matchMedia("(hover: hover)").matches) {
			root.addEventListener("pointerenter", () => root.classList.add("is-open"));
			root.addEventListener("pointerleave", () => {
				if (state.drag || state.flyTimer) return;
				root.classList.remove("is-open");
			});
		}
		state.root = root;
		state.list = items;
		state.card = card;
		state.bar = bar;
	}
	var QUESTION_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\" focusable=\"false\"><circle cx=\"8\" cy=\"8\" r=\"6.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\"/><path d=\"M6.1 6.2a1.9 1.9 0 1 1 2.6 1.8c-.45.2-.7.5-.7 1v.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/><circle cx=\"8\" cy=\"11.1\" r=\".75\" fill=\"currentColor\"/></svg>";
	var ANSWER_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M3.1 3.2h9.8a1.2 1.2 0 0 1 1.2 1.2v5.1a1.2 1.2 0 0 1-1.2 1.2H7.6L4.6 13.2v-2.5H3.1a1.2 1.2 0 0 1-1.2-1.2V4.4a1.2 1.2 0 0 1 1.2-1.2Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linejoin=\"round\"/><path d=\"M4.8 6h6.4M4.8 8.1h4.3\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.3\" stroke-linecap=\"round\"/></svg>";
	var CLOSE_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\" focusable=\"false\"><path d=\"M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.4\" stroke-linecap=\"round\"/></svg>";
	var GRIP_ICON = "<svg viewBox=\"0 0 16 16\" aria-hidden=\"true\" focusable=\"false\"><g fill=\"currentColor\"><circle cx=\"6\" cy=\"4.5\" r=\"1\"/><circle cx=\"10\" cy=\"4.5\" r=\"1\"/><circle cx=\"6\" cy=\"8\" r=\"1\"/><circle cx=\"10\" cy=\"8\" r=\"1\"/><circle cx=\"6\" cy=\"11.5\" r=\"1\"/><circle cx=\"10\" cy=\"11.5\" r=\"1\"/></g></svg>";
	function isShowingAnswer(entry) {
		return Boolean(entry.replies.length) && state.answerPreview.has(entry.key);
	}
	function previewLabel(entry, showingAnswer) {
		const reply = selectedReply(entry);
		const text = showingAnswer && reply ? reply.text : entry.text;
		return (showingAnswer ? "跳到回答：" : "跳到提问：") + (text || "（无正文）");
	}
	function jumpActionLabel(entry, showingAnswer, active) {
		if (!active) return previewLabel(entry, showingAnswer);
		return previewLabel(entry, entry.replies.length ? !showingAnswer : false);
	}
	function applyAnswerPreview(entry, showingAnswer) {
		const row = state.rowsByKey.get(entry.key);
		if (!row) return;
		row.classList.toggle("is-showing-answer", showingAnswer);
		const questionRole = row.querySelector(".dscf-msgnav-role-question");
		const answerRole = row.querySelector(".dscf-msgnav-role-answer");
		questionRole?.setAttribute("aria-pressed", String(!showingAnswer));
		answerRole?.setAttribute("aria-pressed", String(showingAnswer));
		row.querySelector(".dscf-msgnav-jump")?.setAttribute("aria-label", jumpActionLabel(entry, showingAnswer, row.classList.contains("is-active")));
	}
	function switchPreview(entry, showingAnswer) {
		if (showingAnswer && !entry.replies.length) return;
		if (showingAnswer) state.answerPreview.add(entry.key);
		else state.answerPreview.delete(entry.key);
		applyAnswerPreview(entry, showingAnswer);
		if (showingAnswer) jumpToReply(entry);
		else jumpTo(entry);
	}
	function renderItems() {
		ensureDom();
		const nextRows = [];
		const nextByKey = new Map();
		let cursor = state.list.firstElementChild;
		const place = (row) => {
			nextRows.push(row);
			nextByKey.set(row.dataset.key, row);
			if (row === cursor) cursor = row.nextElementSibling;
			else state.list.insertBefore(row, cursor);
		};
		state.entries.forEach((entry) => {
			const row = state.rowsByKey.get(entry.key) || document.createElement("div");
			fillItemRow(row, entry);
			place(row);
			if (entry.replies.length > 1) entry.replies.forEach((reply, index) => {
				const replyRow = state.rowsByKey.get(reply.key) || document.createElement("div");
				fillReplyRow(replyRow, entry, reply, index);
				place(replyRow);
			});
		});
		state.rows.forEach((row) => {
			if (!nextByKey.has(row.dataset.key)) row.remove();
		});
		state.rows = nextRows;
		state.rowsByKey = nextByKey;
	}
	function fillItemRow(row, entry) {
		const showingAnswer = isShowingAnswer(entry);
		const reply = selectedReply(entry);
		const active = entry.key === state.activeKey;
		row.className = "dscf-msgnav-item";
		row.classList.toggle("is-active", active);
		row.classList.toggle("is-showing-answer", showingAnswer);
		row.dataset.key = entry.key;
		delete row.dataset.parentKey;
		const jump = document.createElement("button");
		jump.type = "button";
		jump.className = "dscf-msgnav-jump";
		jump.setAttribute("aria-label", jumpActionLabel(entry, showingAnswer, active));
		const preview = document.createElement("span");
		preview.className = "dscf-msgnav-preview";
		const question = document.createElement("span");
		question.className = "dscf-msgnav-text dscf-msgnav-text-question";
		question.textContent = entry.text || "（无正文）";
		question.title = entry.text || "";
		const answer = document.createElement("span");
		answer.className = "dscf-msgnav-text dscf-msgnav-text-answer";
		answer.textContent = reply ? reply.text || "（无正文）" : "（还没有回答）";
		answer.title = reply ? reply.text || "" : "";
		preview.append(question, answer);
		const indicator = document.createElement("span");
		indicator.className = "dscf-msgnav-indicator";
		const line = document.createElement("span");
		line.className = "dscf-msgnav-line";
		indicator.append(line);
		jump.append(preview);
		const roles = document.createElement("span");
		roles.className = "dscf-msgnav-roles";
		const questionRole = document.createElement("button");
		questionRole.type = "button";
		questionRole.className = "dscf-msgnav-role dscf-msgnav-role-question";
		questionRole.title = "查看提问预览";
		questionRole.setAttribute("aria-label", questionRole.title);
		questionRole.setAttribute("aria-pressed", String(!showingAnswer));
		questionRole.innerHTML = QUESTION_ICON;
		questionRole.addEventListener("click", () => switchPreview(entry, false));
		const answerRole = document.createElement("button");
		answerRole.type = "button";
		answerRole.className = "dscf-msgnav-role dscf-msgnav-role-answer";
		answerRole.disabled = !entry.replies.length;
		answerRole.title = entry.replies.length ? "查看回答预览" : "还没有回答";
		answerRole.setAttribute("aria-label", answerRole.title);
		answerRole.setAttribute("aria-pressed", String(showingAnswer));
		answerRole.innerHTML = ANSWER_ICON;
		if (entry.replies.length) answerRole.addEventListener("click", () => switchPreview(entry, true));
		roles.append(questionRole, answerRole);
		row.replaceChildren(roles, jump, indicator);
		row.onclick = (event) => {
			if (event.target.closest(".dscf-msgnav-roles")) return;
			if (entry.key !== state.activeKey) {
				if (isShowingAnswer(entry)) jumpToReply(entry);
				else jumpTo(entry);
			} else if (entry.replies.length) switchPreview(entry, !isShowingAnswer(entry));
			else jumpTo(entry);
		};
	}
	function fillReplyRow(row, entry, reply, index) {
		row.className = "dscf-msgnav-item is-sub is-showing-answer";
		row.classList.toggle("is-active", reply.key === state.activeKey);
		row.dataset.key = reply.key;
		row.dataset.parentKey = entry.key;
		const roles = document.createElement("span");
		roles.className = "dscf-msgnav-roles";
		const answerRole = document.createElement("button");
		answerRole.type = "button";
		answerRole.className = "dscf-msgnav-role dscf-msgnav-role-answer";
		answerRole.title = "跳到这条回答";
		answerRole.setAttribute("aria-label", "跳到第 " + (index + 1) + " 条回答：" + (reply.text || "（无正文）"));
		answerRole.setAttribute("aria-pressed", "true");
		answerRole.innerHTML = ANSWER_ICON;
		answerRole.addEventListener("click", () => openReply(entry, reply));
		const order = document.createElement("span");
		order.className = "dscf-msgnav-subindex";
		order.textContent = String(index + 1);
		roles.append(answerRole, order);
		const jump = document.createElement("button");
		jump.type = "button";
		jump.className = "dscf-msgnav-jump";
		jump.setAttribute("aria-label", "跳到第 " + (index + 1) + " 条回答：" + (reply.text || "（无正文）"));
		const preview = document.createElement("span");
		preview.className = "dscf-msgnav-preview";
		const answer = document.createElement("span");
		answer.className = "dscf-msgnav-text dscf-msgnav-text-answer";
		answer.textContent = reply.text || "（无正文）";
		answer.title = reply.text || "";
		preview.append(answer);
		jump.append(preview);
		const indicator = document.createElement("span");
		indicator.className = "dscf-msgnav-indicator";
		const line = document.createElement("span");
		line.className = "dscf-msgnav-line";
		indicator.append(line);
		row.replaceChildren(roles, jump, indicator);
		row.onclick = (event) => {
			if (event.target.closest(".dscf-msgnav-roles")) return;
			openReply(entry, reply);
		};
	}
	function openReply(entry, reply) {
		state.answerReply.set(entry.key, reply.key);
		state.answerPreview.add(entry.key);
		applyAnswerPreview(entry, true);
		jumpToKey(reply.key, reply.el, reply.key, true);
	}
	function syncEntryTexts() {
		const entryByKey = new Map(state.entries.map((entry) => [entry.key, entry]));
		const replyByKey = new Map();
		state.entries.forEach((entry) => entry.replies.forEach((reply) => replyByKey.set(reply.key, reply)));
		state.rows.forEach((row) => {
			const entry = entryByKey.get(row.dataset.key);
			if (entry) {
				const reply = selectedReply(entry);
				setRowText(row.querySelector(".dscf-msgnav-text-question"), entry.text, "（无正文）");
				setRowText(row.querySelector(".dscf-msgnav-text-answer"), reply ? reply.text : "", "（还没有回答）");
				const jump = row.querySelector(".dscf-msgnav-jump");
				if (jump) jump.setAttribute("aria-label", jumpActionLabel(entry, row.classList.contains("is-showing-answer"), row.classList.contains("is-active")));
				return;
			}
			const reply = replyByKey.get(row.dataset.key);
			if (!reply) return;
			setRowText(row.querySelector(".dscf-msgnav-text-answer"), reply.text, "（无正文）");
			const jump = row.querySelector(".dscf-msgnav-jump");
			if (jump) {
				const label = "跳到回答：" + (reply.text || "（无正文）");
				jump.setAttribute("aria-label", label);
			}
		});
	}
	function setRowText(node, text, empty) {
		if (!node) return;
		node.textContent = text || empty;
		node.title = text || "";
	}
	function syncVisibility() {
		if (!state.root) return;
		if (state.entries.length >= MIN_ENTRIES) state.shown = true;
		const visible = !state.dismissed && state.shown;
		if (!visible) state.root.classList.remove("is-open");
		state.root.classList.toggle("is-visible", visible);
	}
	function readNavPosition() {
		const raw = storageGet(NAV_POSITION_KEY, "");
		if (!raw) return null;
		try {
			const parsed = JSON.parse(raw);
			if (!parsed) return null;
			const side = parsed.side === "left" ? "left" : "right";
			const ratio = Number.isFinite(parsed.ratio) ? parsed.ratio : Number.isFinite(parsed.top) ? topToRatio(parsed.top) : NaN;
			if (!Number.isFinite(ratio)) return null;
			return {
				side,
				ratio: Math.min(1, Math.max(0, ratio))
			};
		} catch (e) {
			return null;
		}
	}
	function saveNavPosition() {
		if (state.position) storageSet(NAV_POSITION_KEY, JSON.stringify({
			side: state.position.side,
			ratio: state.position.ratio
		}));
	}
	function clampNavLeft(left) {
		const width = state.card?.offsetWidth || 0;
		return Math.min(Math.max(0, left), Math.max(0, window.innerWidth - width));
	}
	function clampNavTop(top) {
		const height = state.root?.getBoundingClientRect().height || 0;
		return Math.min(Math.max(0, top), Math.max(0, window.innerHeight - height));
	}
	function topToRatio(top) {
		return window.innerHeight ? Math.min(1, Math.max(0, top / window.innerHeight)) : 0;
	}
	function ratioToTop(ratio) {
		return clampNavTop(Math.min(1, Math.max(0, ratio)) * window.innerHeight);
	}
	function positionNavCard(side, cardLeft, cardTop) {
		const root = state.root;
		const card = state.card;
		if (!root || !card) return;
		root.classList.toggle("is-left", side === "left");
		root.style.transform = "none";
		root.style.right = "auto";
		root.style.left = side === "left" ? `${cardLeft}px` : `${cardLeft + card.offsetWidth - root.offsetWidth}px`;
		root.style.top = `${cardTop}px`;
	}
	function layoutNavCard(side, top) {
		const root = state.root;
		if (!root) return;
		const left = side === "left";
		root.classList.toggle("is-left", left);
		root.style.top = `${top}px`;
		root.style.transform = "none";
		root.style.left = left ? `${NAV_EDGE}px` : "auto";
		root.style.right = left ? "auto" : `${NAV_EDGE}px`;
	}
	function applyNavPosition(position) {
		state.position = position;
		layoutNavCard(position.side, ratioToTop(position.ratio));
	}
	function keepNavInView() {
		if (!state.position || !state.root || state.drag || state.flyTimer) return;
		const current = parseFloat(state.root.style.top);
		if (!Number.isFinite(current)) return;
		const top = clampNavTop(current);
		if (Math.abs(top - current) < 1) return;
		layoutNavCard(state.position.side, top);
	}
	function rescaleNavPosition() {
		if (!state.position || !state.root || state.drag || state.flyTimer) return;
		applyNavPosition(state.position);
	}
	function flyNavTo(side, cardLeft, cardTop) {
		if (!state.root || !state.card) return;
		const card = state.card.getBoundingClientRect();
		state.root.classList.remove("is-flying");
		positionNavCard(side, card.left, card.top);
		state.root.offsetWidth;
		state.root.classList.add("is-flying");
		positionNavCard(side, cardLeft, cardTop);
		state.position = {
			side,
			ratio: topToRatio(cardTop)
		};
		saveNavPosition();
		clearTimeout(state.flyTimer);
		state.flyTimer = setTimeout(() => {
			state.flyTimer = null;
			state.root?.classList.remove("is-flying");
			if (state.root && !state.root.matches(":hover")) state.root.classList.remove("is-open");
		}, 320);
	}
	function startNavDrag(event) {
		if (event.button !== 0 || !state.root || !state.bar || !state.card) return;
		if (event.target.closest?.(".dscf-msgnav-close")) return;
		clearTimeout(state.flyTimer);
		state.flyTimer = null;
		state.root.classList.remove("is-flying");
		const side = state.position?.side === "left" ? "left" : "right";
		const card = state.card.getBoundingClientRect();
		positionNavCard(side, card.left, card.top);
		state.drag = {
			pointerId: event.pointerId,
			side,
			offsetX: event.clientX - card.left,
			offsetY: event.clientY - card.top,
			cardLeft: card.left,
			cardTop: card.top,
			moved: false
		};
		state.root.classList.add("is-dragging");
		state.bar.setPointerCapture?.(event.pointerId);
		window.addEventListener("pointermove", moveNavDrag);
		window.addEventListener("pointerup", endNavDrag);
		window.addEventListener("pointercancel", endNavDrag);
		event.preventDefault();
	}
	function moveNavDrag(event) {
		const drag = state.drag;
		if (!drag || event.pointerId !== drag.pointerId || !state.root) return;
		const cardLeft = clampNavLeft(event.clientX - drag.offsetX);
		const cardTop = clampNavTop(event.clientY - drag.offsetY);
		if (!drag.moved && Math.hypot(cardLeft - drag.cardLeft, cardTop - drag.cardTop) < 3) return;
		drag.moved = true;
		drag.cardLeft = cardLeft;
		drag.cardTop = cardTop;
		positionNavCard(drag.side, cardLeft, cardTop);
	}
	function endNavDrag(event) {
		const drag = state.drag;
		if (!drag || event.pointerId !== drag.pointerId) return;
		state.drag = null;
		state.root?.classList.remove("is-dragging");
		if (state.bar?.hasPointerCapture?.(drag.pointerId)) state.bar.releasePointerCapture(drag.pointerId);
		stopNavDragListeners();
		if (!drag.moved || !state.root || !state.card) return;
		const width = state.card.offsetWidth;
		const side = event.type === "pointercancel" ? drag.side : drag.cardLeft + width / 2 < window.innerWidth / 2 ? "left" : "right";
		const maxLeft = Math.max(0, window.innerWidth - width);
		flyNavTo(side, side === "left" ? Math.min(NAV_EDGE, maxLeft) : Math.max(0, maxLeft - NAV_EDGE), clampNavTop(drag.cardTop));
	}
	function stopNavDragListeners() {
		window.removeEventListener("pointermove", moveNavDrag);
		window.removeEventListener("pointerup", endNavDrag);
		window.removeEventListener("pointercancel", endNavDrag);
	}
	function clearMessageNav() {
		detachScroller();
		state.entries = [];
		state.signature = "";
		state.activeKey = null;
		state.topInset = 0;
		state.answerPreview.clear();
		state.rows.forEach((row) => row.remove());
		state.rows = [];
		state.rowsByKey = new Map();
		syncVisibility();
	}
	function resetDiscovery() {
		identity = createIdentity();
		state.items = [];
		state.itemsByKey = new Map();
		state.entries = [];
		state.signature = "";
		state.activeKey = null;
		state.answerPreview.clear();
		state.answerReply.clear();
		state.shown = false;
		syncVisibility();
	}
	function attachScroller(scroller) {
		detachScroller();
		state.scroller = scroller;
		state.onScroll = onScroll;
		scroller.addEventListener("scroll", state.onScroll, { passive: true });
		state.onIntent = markScrollIntent;
		[
			"wheel",
			"touchstart",
			"pointerdown"
		].forEach((type) => scroller.addEventListener(type, state.onIntent, { passive: true }));
		document.addEventListener("keydown", state.onIntent);
		state.observer = new MutationObserver(scheduleRefresh);
		state.observer.observe(scroller, {
			childList: true,
			subtree: true
		});
	}
	function detachScroller() {
		if (state.scroller && state.onScroll) state.scroller.removeEventListener("scroll", state.onScroll);
		if (state.scroller && state.onIntent) [
			"wheel",
			"touchstart",
			"pointerdown"
		].forEach((type) => state.scroller.removeEventListener(type, state.onIntent));
		document.removeEventListener("keydown", state.onIntent);
		state.observer?.disconnect();
		state.observer = null;
		state.scroller = null;
		state.onScroll = null;
		state.onIntent = null;
		state.jumpLocked = false;
		state.awaitScroll = false;
	}
	function scheduleRefresh() {
		clearTimeout(state.refreshTimer);
		state.refreshTimer = setTimeout(() => refreshMessageNav(), 300);
	}
	function refreshMessageNav() {
		const entries = mergePass(readPass());
		if (entries.length < MIN_ENTRIES) {
			if (!state.items.length) clearMessageNav();
			return;
		}
		const mounted = state.items.map((item) => item.el).filter((el) => el && el.isConnected);
		const scroller = resolveScroller(mounted);
		if (!scroller) {
			scheduleWatch();
			return;
		}
		if (scroller !== state.scroller) attachScroller(scroller);
		state.topInset = readTopInset(scroller, mounted);
		const signature = makeSignature(entries);
		if (signature !== state.signature) {
			state.signature = signature;
			renderItems();
		} else syncEntryTexts();
		syncVisibility();
		keepNavInView();
		updateActive();
	}
	function scheduleWatch() {
		clearInterval(state.watchTimer);
		state.watchTimer = setInterval(() => {
			if (!getMessageBlocks().length) return;
			clearInterval(state.watchTimer);
			state.watchTimer = null;
			refreshMessageNav();
		}, 800);
	}
	function initMessageNav() {
		if (state.root) return;
		ensureDom();
		const position = readNavPosition();
		if (position) applyNavPosition(position);
		window.addEventListener("resize", rescaleNavPosition);
		state.historyTimer = setInterval(() => {
			if (location.href === state.href) return;
			state.href = location.href;
			resetDiscovery();
			scheduleRefresh();
		}, 700);
		runtime.refreshMessageNav = refreshMessageNav;
		refreshMessageNav();
		if (!getMessageBlocks().length) scheduleWatch();
	}
	function teardownMessageNav() {
		detachScroller();
		stopNavDragListeners();
		window.removeEventListener("resize", rescaleNavPosition);
		clearTimeout(state.refreshTimer);
		state.refreshTimer = null;
		clearInterval(state.watchTimer);
		state.watchTimer = null;
		clearInterval(state.historyTimer);
		state.historyTimer = null;
		state.haloToken += 1;
		state.halo?.remove();
		state.halo = null;
		state.root?.remove();
		state.root = null;
		state.list = null;
		state.card = null;
		state.bar = null;
		state.rows = [];
		state.rowsByKey = new Map();
		state.entries = [];
		state.items = [];
		state.itemsByKey = new Map();
		state.activeKey = null;
		state.signature = "";
		state.topInset = 0;
		state.answerPreview.clear();
		state.answerReply.clear();
		identity = createIdentity();
		state.dismissed = false;
		state.shown = false;
		state.position = null;
		state.drag = null;
		clearTimeout(state.flyTimer);
		state.flyTimer = null;
		if (runtime.refreshMessageNav === refreshMessageNav) runtime.refreshMessageNav = null;
	}
	var THINK_SELECTOR = ".ds-think-content";
	var HEADER_ATTR = "data-dscf-think";
	var ITEM_KEY_ATTR = "data-virtual-list-item-key";
	var WIP_TITLE = /^(正在|思考中|Thinking)/i;
	var SCAN_INTERVAL = 200;
	var MAX_ATTEMPTS = 3;
	var states = new Map();
	var fallbackStates = new WeakMap();
	var observer = null;
	var timer = null;
	var routeKey = "";
	function currentRouteKey() {
		const match = location.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
		return match ? match[1] : "";
	}
	function stateOf(wrapper) {
		const item = wrapper.closest(`[${ITEM_KEY_ATTR}]`);
		const key = item && item.getAttribute(ITEM_KEY_ATTR);
		if (!key) {
			if (!fallbackStates.has(wrapper)) fallbackStates.set(wrapper, {
				touched: false,
				attempts: 0
			});
			return fallbackStates.get(wrapper);
		}
		const fullKey = (routeKey || currentRouteKey()) + "#" + key;
		if (!states.has(fullKey)) states.set(fullKey, {
			touched: false,
			attempts: 0
		});
		return states.get(fullKey);
	}
	function getBlocks() {
		return Array.from(document.querySelectorAll(THINK_SELECTOR)).map((content) => {
			const wrapper = content.parentElement;
			const header = wrapper && wrapper.firstElementChild;
			if (!wrapper || !header || header.contains(content)) return null;
			return {
				wrapper,
				header
			};
		}).filter(Boolean);
	}
	function clickHeader(header) {
		const pageWindow = getPageWindow();
		const MouseEventCtor = pageWindow.MouseEvent || MouseEvent;
		header.dispatchEvent(new MouseEventCtor("click", {
			bubbles: true,
			cancelable: true,
			view: pageWindow
		}));
	}
	function collapseFinished() {
		getBlocks().forEach(({ wrapper, header }) => {
			header.setAttribute(HEADER_ATTR, "1");
			const state = stateOf(wrapper);
			if (state.touched || state.attempts >= MAX_ATTEMPTS) return;
			const title = (header.textContent || "").trim();
			if (!title || WIP_TITLE.test(title)) return;
			state.attempts += 1;
			clickHeader(header);
		});
	}
	function schedule() {
		if (timer) return;
		timer = setTimeout(() => {
			timer = null;
			collapseFinished();
		}, SCAN_INTERVAL);
	}
	function onDocumentClick(event) {
		if (!event.isTrusted) return;
		const target = event.target instanceof Element ? event.target : null;
		const header = target && target.closest(`[${HEADER_ATTR}]`);
		if (header && header.parentElement) stateOf(header.parentElement).touched = true;
	}
	function initThinkCollapse() {
		routeKey = currentRouteKey();
		collapseFinished();
		document.addEventListener("click", onDocumentClick, true);
		observer = new MutationObserver(() => {
			const next = currentRouteKey();
			if (next !== routeKey) {
				routeKey = next;
				states.clear();
			}
			schedule();
		});
		observer.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	function disposeThinkCollapse() {
		clearTimeout(timer);
		timer = null;
		document.removeEventListener("click", onDocumentClick, true);
		if (observer) {
			observer.disconnect();
			observer = null;
		}
		states.clear();
		document.querySelectorAll(`[${HEADER_ATTR}]`).forEach((header) => {
			header.removeAttribute(HEADER_ATTR);
		});
	}
	if (runtime.initialized) runtime.dispose();
	runtime.initialized = true;
	runtime.disposers.push(clearDropHighlight, restoreDisplayTitles, disposeRenameEditor, cleanupInPlace, removeNewFolderButton, disposeNewFolderEditor, disposeFolderRename, disposeThinkCollapse);
	runtime.refreshSelection = updateSelectedState;
	runtime.rebuild = rebuild;
	function checkFrontUpdating() {
		return [
			"cb86951c",
			"dc04ec1d",
			"_546d736",
			"ds-scroll-area"
		].some((className) => !document.querySelector(`.${className}`));
	}
	var isDeepSeek = location.hostname === "chat.deepseek.com";
	function main() {
		addCSSClass();
		initMessageNav();
		runtime.disposers.push(teardownMessageNav);
		if (!isDeepSeek) {
			console.log("[DeepSeek 工具箱] 脚本已加载（消息导航）");
			return;
		}
		addIconFont();
		initKatexCopy();
		console.log("[DeepSeek 工具箱] 脚本已加载，等待会话列表…");
		initThinkCollapse();
		waitFor(() => getOriginalAnchors().length > 0, () => {
			if (checkFrontUpdating()) {
				console.warn("Deepseek 前端已更新，会话目录暂不生效（公式复制不受影响）。");
				return;
			}
			rebuild(true);
			observeChatList();
			initDragAndDrop();
			listenDomain();
			console.log(`[DeepSeek 工具箱] 已初始化，会话数 ${getOriginalAnchors().length}`);
		});
	}
	try {
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", main, { once: true });
		else main();
	} catch (err) {
		console.error("[DeepSeek 工具箱] 初始化失败", err);
	}
})();
