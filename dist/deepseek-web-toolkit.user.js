// ==UserScript==
// @name         DeepSeek 网页端工具箱 - LaTeX 公式复制 & 会话文件夹 & 消息导航 & 折叠思考
// @namespace    http://tampermonkey.net/
// @version      2026.11.12.0245
// @author       sherlocknieh
// @description  增强 DeepSeek 网页端使用体验: 会话文件夹 + 消息导航 + KaTeX 公式复制修正 + 默认折叠思考。
// @license      MIT
// @icon         https://www.deepseek.com/favicon.ico
// @downloadURL  https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js
// @updateURL    https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js
// @match        https://chat.deepseek.com/*
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        https://gemini.google.com/*
// @match        https://grok.com/*
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
		document.getElementById("dscf-fontawesome")?.remove();
		document.getElementById("dscf-style")?.remove();
		const iconLink = document.createElement("link");
		iconLink.id = "dscf-fontawesome";
		iconLink.rel = "stylesheet";
		iconLink.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css";
		document.head.appendChild(iconLink);
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

        /* 通用消息导航（其他站点用；DeepSeek 走原生导航）：右侧圆点常驻，按钮展开完整列表 */
        .dscf-msgnav {
            position: fixed;
            top: 0;
            left: 0;
            height: 400px;
            display: none;
            align-items: flex-start;
            z-index: 40;
            pointer-events: none;
            color: var(--dscf-fg, #1f2329);
        }

        .dscf-msgnav.is-visible {
            display: flex;
        }

        .dscf-msgnav-side {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            pointer-events: auto;
        }

        .dscf-msgnav-toggle {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex: 0 0 20px;
            width: 20px;
            height: 20px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: inherit;
            font-size: 11px;
            cursor: pointer;
            opacity: 0.55;
            transition: opacity 0.15s ease, color 0.15s ease;
        }

        .dscf-msgnav-toggle:hover,
        .dscf-msgnav-toggle.is-active {
            opacity: 1;
            color: #6770FE;
        }

        .dscf-msgnav-rail {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
            max-height: 100%;
            overflow: hidden;
        }

        .dscf-msgnav-dot {
            flex: 0 0 auto;
            width: 6px;
            height: 6px;
            padding: 0;
            border: 0;
            border-radius: 999px;
            background: currentColor;
            opacity: 0.22;
            cursor: pointer;
            transition: opacity 0.15s ease, background-color 0.15s ease, width 0.15s ease;
        }

        .dscf-msgnav-dot:hover {
            opacity: 0.7;
        }

        .dscf-msgnav-dot.is-active {
            background: #6770FE;
            opacity: 1;
            width: 10px !important;
        }

        /* 面板绝对定位到圆点左侧，避免被视口右缘裁掉 */
        .dscf-msgnav-panel {
            position: absolute;
            top: 0;
            right: calc(100% + 8px);
            pointer-events: auto;
            display: flex;
            flex-direction: column;
            width: 300px;
            max-height: min(60vh, var(--dscf-msgnav-height, 400px));
            border-radius: 12px;
            background: var(--dscf-panel-bg, rgba(255, 255, 255, 0.98));
            box-shadow: 0 8px 28px rgba(0, 0, 0, 0.16);
            border: 1px solid rgba(127, 127, 127, 0.16);
            overflow: hidden;
        }

        .dscf-msgnav-panel[hidden] {
            display: none;
        }

        .dscf-msgnav-head {
            flex: 0 0 auto;
            padding: 10px 12px 6px;
            font-size: 12px;
            font-weight: 600;
            opacity: 0.6;
        }

        .dscf-msgnav-list {
            flex: 1 1 auto;
            overflow-y: auto;
            padding: 0 6px 8px;
        }

        .dscf-msgnav-item {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            width: 100%;
            padding: 7px 8px;
            border: 0;
            border-radius: 8px;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }

        .dscf-msgnav-item:hover {
            background: rgba(103, 112, 254, 0.10);
        }

        .dscf-msgnav-item.is-active {
            background: rgba(103, 112, 254, 0.16);
        }

        .dscf-msgnav-item > i {
            flex: 0 0 12px;
            margin-top: 4px;
            font-size: 10px;
            opacity: 0.55;
            text-align: center;
        }

        .dscf-msgnav-text {
            flex: 1 1 auto;
            min-width: 0;
            font-size: 12px;
            line-height: 1.5;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .dscf-msgnav-index {
            flex: 0 0 auto;
            font-size: 10px;
            opacity: 0.4;
            margin-top: 2px;
        }

        /* 深色主题：各站点标记不同（ChatGPT/Grok 用 html.dark，DeepSeek 用 body.dark，
           Gemini 用 dark-theme / data-theme），全部跟随，避免深色底上画出深色圆点 */
        html.dark .dscf-msgnav,
        body.dark .dscf-msgnav,
        .dark-theme .dscf-msgnav,
        [data-theme="dark"] .dscf-msgnav {
            --dscf-fg: #e6e8eb;
            --dscf-panel-bg: rgba(38, 40, 44, 0.98);
        }

        /* 跳转目标短暂高亮 */
        [data-dscf-flash] {
            border-radius: 8px;
            animation: dscf-flash 1.6s ease-out;
        }

        @keyframes dscf-flash {
            from { background-color: rgba(103, 112, 254, 0.22); }
            to { background-color: transparent; }
        }

        /* 原生消息导航被前端在 768px 以下设成 display:none，宽屏也要悬停才露出。
           这里不设断点、全程常显：断点两侧的媒体查询区间不重合，缩放跨过 768px
           时会先消失再出现 */
        [style*="--scroll-nav-page-padding"] {
            display: flex !important;
        }

        /* 窄屏给消息列表补右内边距，避开导航。应用在 768px 处把列表外边距从 44px
           收到 20px，这里把下限同步从 14px 提到 38px，右侧总留白全程都是 58px，
           缩放跨断点不再突然变宽 */
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
	var FLASH_MS = 1600;
	var MIN_ENTRIES = 3;
	var SITE_ADAPTERS = [
		{
			hosts: ["chatgpt.com", "chat.openai.com"],
			selector: "[data-message-author-role]",
			role: (el) => el.getAttribute("data-message-author-role") === "user" ? "USER" : "ASSISTANT",
			scroller: "main"
		},
		{
			hosts: ["gemini.google.com"],
			selector: "user-query, model-response",
			role: (el) => el.tagName.toLowerCase() === "user-query" ? "USER" : "ASSISTANT",
			content: (el) => el.querySelector("div.query-content") || el.querySelector("message-content") || el,
			scroller: "infinite-scroller, #chat-history"
		},
		{
			hosts: ["grok.com"],
			selector: "div[id^='response-']",
			role: (el) => el.matches(".items-end") ? "USER" : "ASSISTANT",
			content: (el) => el.querySelector(".response-content-markdown") || el,
			scroller: "main"
		}
	];
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
		entries: [],
		signature: "",
		root: null,
		rail: null,
		dots: [],
		toggle: null,
		panel: null,
		list: null,
		rows: [],
		open: false,
		activeKey: null,
		observer: null,
		onScroll: null,
		historyTimer: null,
		href: location.href,
		refreshTimer: null,
		watchTimer: null,
		layoutFrame: 0,
		flashing: new Map()
	};
	function readText(el) {
		const clone = (ADAPTER && ADAPTER.content ? ADAPTER.content(el) : el).cloneNode(true);
		clone.querySelectorAll("button, svg, [aria-hidden=\"true\"], nav, form").forEach((node) => node.remove());
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
	function resolveScroller(blocks) {
		if (ADAPTER && ADAPTER.scroller) {
			const hinted = blocks[0].closest(ADAPTER.scroller);
			if (hinted && hinted.scrollHeight > hinted.clientHeight + 40) return hinted;
		}
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
			return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 200;
		}).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null;
	}
	function readEntries() {
		return getMessageBlocks().map((el, index) => ({
			key: String(index),
			el,
			role: detectRole(el, index),
			text: readText(el)
		}));
	}
	function makeSignature(entries) {
		return entries.map((entry) => entry.key + ":" + entry.text.slice(0, 12)).join("|");
	}
	function isUserEntry(entry) {
		return entry.role === "USER";
	}
	function findBlock(entry) {
		if (entry.el && entry.el.isConnected) return entry.el;
		return getMessageBlocks()[Number(entry.key)] || null;
	}
	function jumpTo(entry) {
		const block = findBlock(entry);
		if (!block) return;
		block.scrollIntoView({
			behavior: "smooth",
			block: "start"
		});
		flashEntry(block);
		setActive(entry.key);
		closePanel();
	}
	function flashEntry(block) {
		clearTimeout(state.flashing.get(block));
		block.setAttribute("data-dscf-flash", "1");
		const timer = setTimeout(() => block.removeAttribute("data-dscf-flash"), FLASH_MS);
		state.flashing.set(block, timer);
	}
	function updateActive() {
		if (!state.entries.length || !state.scroller) return;
		const limit = state.scroller.getBoundingClientRect().top + 96;
		let key = state.entries[0].key;
		for (const entry of state.entries) {
			const block = findBlock(entry);
			if (block && block.getBoundingClientRect().top <= limit) key = entry.key;
		}
		setActive(key);
	}
	function setActive(key) {
		if (state.activeKey === key) return;
		state.activeKey = key;
		state.dots.forEach((dot) => dot.classList.toggle("is-active", dot.dataset.key === key));
		state.rows.forEach((row) => row.classList.toggle("is-active", row.dataset.key === key));
	}
	function scheduleLayout() {
		cancelAnimationFrame(state.layoutFrame);
		state.layoutFrame = requestAnimationFrame(() => {
			updateLayout();
			updateRailSpacing();
		});
	}
	function updateLayout() {
		const scroller = state.scroller;
		const root = state.root;
		if (!scroller || !root) return;
		const rect = scroller.getBoundingClientRect();
		const left = Math.min(rect.right, window.innerWidth) - 36;
		const top = Math.max(rect.top + 48, 0);
		const height = Math.max(160, rect.height - 120);
		root.style.left = `${Math.round(left)}px`;
		root.style.top = `${Math.round(top)}px`;
		root.style.height = `${Math.round(height)}px`;
		root.style.setProperty("--dscf-msgnav-height", `${Math.round(height)}px`);
	}
	function updateRailSpacing() {
		if (!state.rail) return;
		const count = state.entries.length;
		const height = parseFloat(getComputedStyle(state.root).getPropertyValue("--dscf-msgnav-height")) || 0;
		const slot = count ? height / count : 0;
		const size = Math.max(2, Math.min(6, slot * .6));
		const gap = Math.max(0, Math.min(8, slot - size));
		state.rail.style.gap = `${Math.round(gap * 10) / 10}px`;
		state.dots.forEach((dot) => {
			dot.style.height = `${Math.round(size * 10) / 10}px`;
			dot.style.width = `${Math.round(Math.max(2, size) * 10) / 10}px`;
		});
	}
	function ensureDom() {
		if (state.root) return;
		const root = document.createElement("div");
		root.className = "dscf-msgnav";
		root.setAttribute(NAV_ATTR, "1");
		const side = document.createElement("div");
		side.className = "dscf-msgnav-side";
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "dscf-msgnav-toggle";
		toggle.title = "消息导航";
		toggle.innerHTML = "<i class=\"fa-solid fa-list-ul\"></i>";
		toggle.addEventListener("click", togglePanel);
		const rail = document.createElement("div");
		rail.className = "dscf-msgnav-rail";
		const panel = document.createElement("div");
		panel.className = "dscf-msgnav-panel";
		panel.hidden = true;
		const head = document.createElement("div");
		head.className = "dscf-msgnav-head";
		const list = document.createElement("div");
		list.className = "dscf-msgnav-list";
		panel.append(head, list);
		side.append(toggle, rail);
		root.append(side, panel);
		document.body.appendChild(root);
		state.root = root;
		state.rail = rail;
		state.toggle = toggle;
		state.panel = panel;
		state.list = list;
		document.addEventListener("mousedown", onDocumentMouseDown, true);
		document.addEventListener("keydown", onDocumentKeyDown, true);
		window.addEventListener("resize", scheduleLayout);
	}
	function onDocumentMouseDown(event) {
		if (!state.open) return;
		if (state.root && state.root.contains(event.target)) return;
		closePanel();
	}
	function onDocumentKeyDown(event) {
		if (event.key === "Escape" && state.open) closePanel();
	}
	function renderRail() {
		ensureDom();
		state.dots.forEach((dot) => dot.remove());
		state.dots = state.entries.map((entry) => {
			const dot = document.createElement("button");
			dot.type = "button";
			dot.className = "dscf-msgnav-dot";
			dot.classList.toggle("is-active", entry.key === state.activeKey);
			dot.dataset.key = entry.key;
			dot.title = `${isUserEntry(entry) ? "我" : "回答"}：${entry.text || "（无正文）"}`.slice(0, 120);
			dot.addEventListener("click", () => jumpTo(entry));
			state.rail.appendChild(dot);
			return dot;
		});
		state.toggle.classList.toggle("is-active", state.open);
	}
	function renderList() {
		ensureDom();
		state.rows.forEach((row) => row.remove());
		state.rows = state.entries.map((entry, index) => {
			const row = document.createElement("button");
			row.type = "button";
			row.className = "dscf-msgnav-item";
			row.classList.toggle("is-active", entry.key === state.activeKey);
			row.dataset.key = entry.key;
			const icon = document.createElement("i");
			icon.className = isUserEntry(entry) ? "fa-solid fa-user" : "fa-solid fa-robot";
			const text = document.createElement("span");
			text.className = "dscf-msgnav-text";
			text.textContent = entry.text || "（无正文）";
			text.title = entry.text || "";
			const badge = document.createElement("span");
			badge.className = "dscf-msgnav-index";
			badge.textContent = String(index + 1);
			row.append(icon, text, badge);
			row.addEventListener("click", () => jumpTo(entry));
			state.list.appendChild(row);
			return row;
		});
		state.panel.querySelector(".dscf-msgnav-head").textContent = `消息导航 · ${state.entries.length}`;
	}
	function syncVisibility() {
		if (!state.root) return;
		const visible = state.entries.length >= MIN_ENTRIES;
		state.root.classList.toggle("is-visible", visible);
		if (!visible && state.open) closePanel();
	}
	function togglePanel() {
		if (state.open) {
			closePanel();
			return;
		}
		state.open = true;
		state.panel.hidden = false;
		state.toggle.classList.add("is-active");
		state.rows.find((row) => row.dataset.key === state.activeKey)?.scrollIntoView({ block: "nearest" });
	}
	function closePanel() {
		state.open = false;
		state.toggle?.classList.remove("is-active");
		if (state.panel) state.panel.hidden = true;
	}
	function attachScroller(scroller) {
		detachScroller();
		state.scroller = scroller;
		state.onScroll = () => {
			updateActive();
			scheduleLayout();
		};
		scroller.addEventListener("scroll", state.onScroll, { passive: true });
		state.observer = new MutationObserver(scheduleRefresh);
		state.observer.observe(scroller, {
			childList: true,
			subtree: true
		});
		scheduleLayout();
	}
	function detachScroller() {
		if (state.scroller && state.onScroll) state.scroller.removeEventListener("scroll", state.onScroll);
		state.observer?.disconnect();
		state.observer = null;
		state.scroller = null;
		state.onScroll = null;
	}
	function scheduleRefresh() {
		clearTimeout(state.refreshTimer);
		state.refreshTimer = setTimeout(() => refreshMessageNav(), 300);
	}
	function refreshMessageNav() {
		const entries = readEntries();
		if (entries.length < MIN_ENTRIES) {
			state.entries = entries;
			state.signature = "";
			syncVisibility();
			return;
		}
		const scroller = resolveScroller(entries.map((entry) => entry.el));
		if (!scroller) {
			syncVisibility();
			return;
		}
		if (scroller !== state.scroller) attachScroller(scroller);
		const signature = makeSignature(entries);
		if (signature === state.signature) {
			syncVisibility();
			scheduleLayout();
			updateActive();
			return;
		}
		state.signature = signature;
		state.entries = entries;
		renderRail();
		renderList();
		syncVisibility();
		updateLayout();
		updateRailSpacing();
		updateActive();
	}
	function scheduleWatch() {
		clearInterval(state.watchTimer);
		state.watchTimer = setInterval(() => {
			if (readEntries().length < MIN_ENTRIES) return;
			clearInterval(state.watchTimer);
			state.watchTimer = null;
			refreshMessageNav();
		}, 800);
	}
	function initMessageNav() {
		ensureDom();
		state.historyTimer = setInterval(() => {
			if (location.href === state.href) return;
			state.href = location.href;
			scheduleRefresh();
		}, 700);
		runtime.refreshMessageNav = refreshMessageNav;
		runtime.disposers.push(teardownMessageNav);
		refreshMessageNav();
		if (readEntries().length < MIN_ENTRIES) scheduleWatch();
	}
	function teardownMessageNav() {
		detachScroller();
		clearTimeout(state.refreshTimer);
		state.refreshTimer = null;
		clearInterval(state.watchTimer);
		state.watchTimer = null;
		clearInterval(state.historyTimer);
		state.historyTimer = null;
		cancelAnimationFrame(state.layoutFrame);
		state.flashing.forEach((timer) => clearTimeout(timer));
		state.flashing.clear();
		document.removeEventListener("mousedown", onDocumentMouseDown, true);
		document.removeEventListener("keydown", onDocumentKeyDown, true);
		window.removeEventListener("resize", scheduleLayout);
		state.root?.remove();
		state.root = null;
		state.rail = null;
		state.toggle = null;
		state.panel = null;
		state.list = null;
		state.dots = [];
		state.rows = [];
		state.open = false;
		state.entries = [];
		state.activeKey = null;
		state.signature = "";
		if (runtime.refreshMessageNav === refreshMessageNav) runtime.refreshMessageNav = null;
	}
	var NARROW_QUERY = "(max-width: 1200px)";
	var PATCH_FLAG = "__dscf_native_nav_patched__";
	function normalize(query) {
		return String(query).replace(/\s+/g, "").toLowerCase();
	}
	function createNeverMatch(query) {
		return {
			matches: false,
			media: query,
			onchange: null,
			addListener() {},
			removeListener() {},
			addEventListener() {},
			removeEventListener() {},
			dispatchEvent() {
				return false;
			}
		};
	}
	function patchNativeNavBreakpoint() {
		const pageWindow = typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		if (pageWindow[PATCH_FLAG]) return;
		const original = pageWindow.matchMedia.bind(pageWindow);
		const target = normalize(NARROW_QUERY);
		pageWindow.matchMedia = function(query) {
			if (normalize(query) === target) return createNeverMatch(query);
			return original(query);
		};
		pageWindow[PATCH_FLAG] = true;
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
	patchNativeNavBreakpoint();
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
		initKatexCopy();
		if (!isDeepSeek) {
			console.log("[DeepSeek 工具箱] 脚本已加载（消息导航）");
			initMessageNav();
			return;
		}
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
