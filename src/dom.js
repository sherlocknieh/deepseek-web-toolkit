import { HIDDEN_ATTR, CHAT_ATTR } from './constants.js';

// 侧栏滚动容器和其中的原始会话链接（目录行不是链接，不会被误采集）
export function getScrollArea() {
    return document.querySelector('.ds-scroll-area');
}

// 折叠隐藏用 data 属性而不是 class：React 在切换选中会话时会重写会话行的
// className，把脚本加的 class 一起抹掉，导致折叠中的会话跑到目录外
export function setSubtreeHidden(el, hidden) {
    if (!el) return;
    if (hidden) {
        el.setAttribute(HIDDEN_ATTR, '1');
    } else {
        el.removeAttribute(HIDDEN_ATTR);
    }
}

export function isSubtreeHidden(el) {
    return !!el && el.hasAttribute(HIDDEN_ATTR);
}

// 标记“已纳入目录”的会话行，清理时靠它找回脚本改过 order/缩进的节点
export function markChatRow(anchor, marked) {
    if (!anchor) return;
    if (marked) {
        anchor.setAttribute(CHAT_ATTR, '1');
    } else {
        anchor.removeAttribute(CHAT_ATTR);
    }
}

export function getOriginalAnchors() {
    const scrollArea = getScrollArea();
    return scrollArea ? Array.from(scrollArea.querySelectorAll('a[href^="/a/chat/s/"]')) : [];
}

// 置顶区：优先用当前前端的额外 class，失败时按分组标题文字识别
export function getPinnedSection() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return null;

    const byClass = scrollArea.querySelector('._63701b7');
    if (byClass && /^(置顶|Pinned)/.test((byClass.innerText || '').trim())) {
        return byClass;
    }

    const content = scrollArea.querySelector('._77cdc67') || scrollArea;
    const byText = Array.from(content.children).find(sec =>
        /^(置顶|Pinned)/.test((sec.innerText || '').trim())
    );
    if (byText) return byText;

    // 兜底：从“置顶”文字节点向上找到第一个包含会话链接的祖先
    const label = Array.from(scrollArea.querySelectorAll('span, div')).find(el =>
        el.children.length === 0 && /^(置顶|Pinned)$/.test((el.textContent || '').trim())
    );
    if (!label) return null;

    let section = label;
    while (section && section !== scrollArea && !section.querySelector('a[href^="/a/chat/s/"]')) {
        section = section.parentElement;
    }
    return section && section !== scrollArea ? section : null;
}

export function isAnchorPinned(anchor) {
    const section = getPinnedSection();
    return !!section && section.contains(anchor);
}

// 目录行沿用 DeepSeek 侧栏会话项的 class，保证明暗主题一致
export function getAnchorClass() {
    const first = getOriginalAnchors()[0];
    return first ? first.classList[0] : '';
}

// DeepSeek 表示"当前选中会话"的 class，前端更新后需要同步
export function getAnchorSelectedClass() {
    return 'b64fb9ae';
}

// 应用重命名时会临时把会话行替换成列表里的输入框（在滚动区内），
// 它不是会话行的子元素；搜索框在滚动区外，不会误判
export function getRenameEditor() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return null;
    return scrollArea.querySelector('input.ds-input__input');
}

// 会话标题在第 2 个子元素，第 3 个是"更多"按钮，取文本时不要带上按钮里的文案
export function getRawTitle(chatAnchor) {
    const titleEl = chatAnchor.children[1];
    const text = titleEl && titleEl.textContent.trim() ? titleEl.textContent : chatAnchor.textContent;
    return (text || '').trim();
}

// 只替换标题元素里的文本节点，避免破坏应用渲染的其他子节点
export function setAnchorTitle(anchor, title) {
    const titleEl = anchor.children[1];
    if (!titleEl) return;

    const walker = document.createTreeWalker(titleEl, NodeFilter.SHOW_TEXT);
    const textNode = walker.nextNode();
    if (textNode) {
        textNode.nodeValue = title;
    } else {
        titleEl.textContent = title;
    }
}

// 从会话链接里取聊天 id，用于重命名接口和标题覆盖
export function getChatIdFromHref(anchor) {
    const href = anchor.getAttribute('href') || '';
    const match = href.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
    return match ? match[1] : null;
}

// 从地址栏取当前会话 id
export function extractIdFromUrl(url) {
    try {
        const u = new URL(url);
        const match = u.pathname.match(/\/a\/chat\/s\/([a-f0-9-]+)/i);
        return match ? match[1] : null;
    } catch (e) {
        console.error("Invalid URL:", e);
        return null;
    }
}
