import {
    getRawTitle,
    setAnchorTitle,
    getOriginalAnchors,
    getChatIdFromHref,
    getScrollArea,
    isAnchorPinned
} from './dom.js';
import { parseChatPath } from './path.js';
import { pinChatByMenu } from './pin.js';
import { runtime } from './runtime.js';

// 拖动后服务端已改名，但应用内存里的标题还是旧值；
// 用本地覆盖保证当前页面立刻显示新路径，应用重新拉取或用户再改名后覆盖自动让位
const TITLE_OVERRIDES = new Map();

// 记录上一轮标题，用来识别“未置顶会话被改名成目录路径”，从而自动置顶
const lastTitles = new Map();

// 完整标题：叶子行会把显示文本改成末段名称，完整路径存在 data 属性里；
// 如果应用把标题改成了第三个值（用户改名），以新标题为准
export function getChatTitle(chatAnchor) {
    const stored = chatAnchor.dataset ? chatAnchor.dataset.dscfFullTitle : '';
    if (!stored) {
        return getRawTitle(chatAnchor);
    }

    const raw = getRawTitle(chatAnchor);
    const parsed = parseChatPath(stored);
    const leaf = parsed ? parsed.chatName : stored;

    if (raw === stored || raw === leaf) {
        return stored;
    }

    delete chatAnchor.dataset.dscfFullTitle;
    return raw;
}

// 叶子行只显示末段名称；完整路径保存在 data 属性里，悬停显示完整路径
export function applyLeafTitle(anchor, fullTitle, showLeaf) {
    const parsed = parseChatPath(fullTitle);
    const leaf = parsed ? parsed.chatName : fullTitle;
    const stored = anchor.dataset.dscfFullTitle;

    if (!showLeaf) {
        if (stored) {
            if (getRawTitle(anchor) !== fullTitle) {
                setAnchorTitle(anchor, fullTitle);
            }
            delete anchor.dataset.dscfFullTitle;
        }
        if (anchor.dataset.dscfTitleSet) {
            anchor.removeAttribute('title');
            delete anchor.dataset.dscfTitleSet;
        }
        return;
    }

    anchor.dataset.dscfFullTitle = fullTitle;

    if (getRawTitle(anchor) !== leaf) {
        setAnchorTitle(anchor, leaf);
    }

    if (anchor.dataset.dscfTitleSet) {
        if (anchor.title !== fullTitle) {
            anchor.title = fullTitle;
        }
    } else if (!anchor.hasAttribute('title')) {
        anchor.title = fullTitle;
        anchor.dataset.dscfTitleSet = '1';
    }
}

// 脚本停用/热更新前恢复完整标题，避免页面残留末段名称
export function restoreDisplayTitles() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    scrollArea.querySelectorAll('a[data-dscf-full-title]').forEach(anchor => {
        const fullTitle = anchor.dataset.dscfFullTitle;
        if (fullTitle) {
            setAnchorTitle(anchor, fullTitle);
        }
        delete anchor.dataset.dscfFullTitle;

        if (anchor.dataset.dscfTitleSet) {
            anchor.removeAttribute('title');
            delete anchor.dataset.dscfTitleSet;
        }
    });
}

// 每次重排前校正覆盖的标题：
// - DOM 还是旧标题：应用重渲染回去了，重新写回新标题
// - DOM 既不是旧标题也不是新标题：应用已拉取或用户手动改名，删除覆盖
export function syncTitleOverrides(anchors) {
    const present = new Set();

    anchors.forEach(anchor => {
        const chatId = getChatIdFromHref(anchor);
        if (!chatId) return;
        present.add(chatId);

        const override = TITLE_OVERRIDES.get(chatId);
        if (!override) return;

        const domTitle = getChatTitle(anchor);
        if (domTitle === override.to) return;

        if (domTitle === override.from) {
            setAnchorTitle(anchor, override.to);
        } else {
            TITLE_OVERRIDES.delete(chatId);
        }
    });

    Array.from(TITLE_OVERRIDES.keys()).forEach(chatId => {
        if (!present.has(chatId)) {
            TITLE_OVERRIDES.delete(chatId);
        }
    });
}

// 识别未置顶会话被手动改名成“目录/会话”的情况：自动置顶，让目录只出现在置顶区
export function detectUnpinnedFolderRename(anchors) {
    const nextTitles = new Map();

    anchors.forEach(anchor => {
        const chatId = getChatIdFromHref(anchor);
        if (!chatId) return;

        const title = getChatTitle(anchor);
        nextTitles.set(chatId, title);

        const previous = lastTitles.get(chatId);
        if (previous === undefined || previous === title) return;
        if (!parseChatPath(title)) return;
        if (isAnchorPinned(anchor)) return;
        if (runtime.moving || runtime.pinning.has(chatId)) return;

        // 改名后自动置顶；失败只记日志，避免反复弹窗打断
        pinChatByMenu(chatId).then(ok => {
            if (!ok) {
                console.warn('[DeepSeek 工具箱] 自动置顶失败，可能已达置顶上限');
            }
        });
    });

    lastTitles.clear();
    nextTitles.forEach((title, chatId) => lastTitles.set(chatId, title));
}

// 记录并立即应用标题覆盖；多次移动时保留最早的旧标题用于识别应用回写
export function applyTitleOverride(chatId, fromTitle, toTitle) {
    const existing = TITLE_OVERRIDES.get(chatId);
    TITLE_OVERRIDES.set(chatId, {
        from: existing ? existing.from : fromTitle,
        to: toTitle
    });

    const anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === chatId);
    if (anchor) {
        // 叶子行显示的是末段名称，数据集里保存的完整标题也要同步更新，
        // 否则把会话移到根级、新标题正好等于旧末段时会被误判为旧路径
        if (anchor.dataset.dscfFullTitle) {
            anchor.dataset.dscfFullTitle = toTitle;
        }
        setAnchorTitle(anchor, toTitle);
    }
}
