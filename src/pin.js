import { runtime } from './runtime.js';
import { getOriginalAnchors, getChatIdFromHref, isAnchorPinned } from './dom.js';

// 在应用弹出的菜单里按文字找菜单项
function findMenuLabel(text) {
    const labels = Array.from(document.querySelectorAll('.ds-dropdown-menu-option__label'));
    return labels.find(el => el.textContent.trim() === text) || null;
}

// 轮询等待条件成立，用于等菜单出现、等会话移动到置顶区
function waitUntil(predicate, timeout = 2000, interval = 50) {
    return new Promise(resolve => {
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

// 置顶操作串行执行，避免同时打开多个会话的菜单导致点错对象
let pinQueue = Promise.resolve();

export function pinChatByMenu(chatId) {
    const run = pinQueue.then(() => doPinChatByMenu(chatId));
    pinQueue = run.catch(() => undefined);
    return run;
}

// 用应用自己的“置顶”菜单项置顶：会同步应用状态并把会话移动到置顶区
async function doPinChatByMenu(chatId) {
    if (runtime.pinning.has(chatId)) return false;
    runtime.pinning.add(chatId);

    try {
        let anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === chatId);
        if (!anchor) return false;
        if (isAnchorPinned(anchor)) return true;

        // 关掉可能已经打开的菜单，避免点到别的会话的“置顶”
        if (document.querySelector('.ds-floating-position-wrapper')) {
            document.body.click();
            await waitUntil(() => !document.querySelector('.ds-floating-position-wrapper'), 500);
        }

        const menuBtn = anchor.children[2] ? anchor.children[2].querySelector('[role="button"]') : null;
        if (!menuBtn) return false;
        menuBtn.click();

        const appeared = await waitUntil(() => !!(findMenuLabel('置顶') || findMenuLabel('Pin')), 1500);
        if (!appeared) {
            document.body.click();
            return false;
        }

        const label = findMenuLabel('置顶') || findMenuLabel('Pin');
        (label.closest('.ds-dropdown-menu-option') || label).click();

        // 等应用真正把会话移动到置顶区
        const moved = await waitUntil(() => {
            const current = getOriginalAnchors().find(a => getChatIdFromHref(a) === chatId);
            return !!current && isAnchorPinned(current);
        }, 3000);

        if (!moved) {
            document.body.click();
        }
        return moved;
    } finally {
        runtime.pinning.delete(chatId);
    }
}
