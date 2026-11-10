import { runtime } from './runtime.js';
import { getScrollArea, getOriginalAnchors, getChatIdFromHref, isAnchorPinned } from './dom.js';
import { getChatTitle } from './titles.js';
import { parseChatPath } from './path.js';
import { pinChatByMenu } from './pin.js';
import { renameChat } from './api.js';
import { dropExtraFolderChain } from './storage.js';
import { moveFolderSubtree } from './folder.js';
import { rebuild } from './observer.js';

// 把拖动经过的元素解析成目标：目录行 → 目录，会话项 → 该会话所在目录，空白/分组标题 → 根级
function resolveDropTarget(node) {
    const row = node && node.closest ? node.closest('.dscf-folder-row') : null;
    if (row) {
        return { type: 'folder', path: row.dataset.path, element: row };
    }

    const anchor = node && node.closest ? node.closest('a[href^="/a/chat/s/"]') : null;
    if (anchor) {
        const parsed = parseChatPath(getChatTitle(anchor));
        return {
            type: 'chat',
            // 未置顶会话是平铺的，即使名字里有斜杠也按根级处理
            path: parsed && isAnchorPinned(anchor) ? parsed.folderPath.join('/') : '',
            element: anchor
        };
    }

    return { type: 'root', path: '', element: getScrollArea() };
}

// 判断这次拖动是否有意义：同目录、拖到自身/祖先/后代目录都直接忽略
function canDrop(drag, target) {
    if (!drag || !target) return false;

    if (drag.type === 'chat') {
        return target.path !== (drag.folderPath || '');
    }

    if (!target.path) {
        return drag.path.includes('/');
    }
    if (target.path === drag.path || target.path.startsWith(drag.path + '/')) {
        return false;
    }
    if (drag.path.startsWith(target.path + '/')) {
        return false;
    }
    return true;
}

// 清除拖动高亮；同一目标内反复 dragover 时由 dropKey 避免重复改 DOM
export function clearDropHighlight() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    scrollArea.classList.remove('dscf-drop-root');
    scrollArea.querySelectorAll('.dscf-drop-target').forEach(el => {
        el.classList.remove('dscf-drop-target');
    });
    runtime.dropKey = null;
}

function highlightDropTarget(target) {
    const key = target.type + ':' + target.path;
    const scrollArea = getScrollArea();
    const already = target.type === 'root'
        ? !!scrollArea && scrollArea.classList.contains('dscf-drop-root')
        : !!target.element && target.element.classList.contains('dscf-drop-target');

    if (runtime.dropKey === key && already) return;

    clearDropHighlight();
    runtime.dropKey = key;

    if (target.type === 'root') {
        if (scrollArea) {
            scrollArea.classList.add('dscf-drop-root');
        }
    } else if (target.element) {
        target.element.classList.add('dscf-drop-target');
    }
}

// 执行移动：会话改名后在服务端就是新路径；整目录移动则逐个改子树里的置顶会话
async function handleDrop(drag, target) {
    if (runtime.moving) return;

    runtime.moving = true;
    const scrollArea = getScrollArea();
    if (scrollArea) {
        scrollArea.classList.add('dscf-moving');
    }

    try {
        if (drag.type === 'chat') {
            let anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === drag.chatId);
            if (!anchor) return;

            // 目录只作用于置顶区：未置顶会话先置顶，成功后再改路径
            if (!isAnchorPinned(anchor)) {
                const pinned = await pinChatByMenu(drag.chatId);
                if (!pinned) {
                    throw new Error('置顶失败，无法放入目录（可能已达置顶上限）');
                }
                anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === drag.chatId) || anchor;
            }

            const title = getChatTitle(anchor);
            const parsed = parseChatPath(title);
            const leaf = parsed ? parsed.chatName : title;
            const newTitle = target.path ? target.path + '/' + leaf : leaf;

            if (newTitle !== title) {
                await renameChat(drag.chatId, title, newTitle);
            }

            // 目标路径已经由会话标题支撑，删掉手动新建时的空目录占位
            dropExtraFolderChain(target.path);
            return;
        }

        // 目录移动：整棵子树的会话改到目标目录下，空目录占位和展开状态一起迁移
        const base = target.path ? target.path + '/' + drag.name : drag.name;
        await moveFolderSubtree(drag.path, base);

        // 整目录落进目标目录后，目标路径也由标题支撑，清掉它的空占位记录
        dropExtraFolderChain(target.path);
    } catch (err) {
        console.error('DeepSeek 工具箱：移动失败', err);
        alert('移动失败：' + (err && err.message ? err.message : err));
    } finally {
        runtime.moving = false;
        if (scrollArea) {
            scrollArea.classList.remove('dscf-moving');
        }
        rebuild(true);
    }
}

// 在列表容器上做事件委托，避免每次重排都往会话节点上重复绑监听
export function initDragAndDrop() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    const abort = new AbortController();
    runtime.dragAbort = abort;

    scrollArea.addEventListener('dragstart', (e) => {
        const row = e.target.closest ? e.target.closest('.dscf-folder-row') : null;
        const anchor = e.target.closest ? e.target.closest('a[href^="/a/chat/s/"]') : null;

        if (row) {
            const path = row.dataset.path;
            runtime.drag = { type: 'folder', path, name: path.split('/').pop() };
        } else if (anchor) {
            const title = getChatTitle(anchor);
            const parsed = parseChatPath(title);
            const pinned = isAnchorPinned(anchor);
            runtime.drag = {
                type: 'chat',
                chatId: getChatIdFromHref(anchor),
                title,
                pinned,
                folderPath: pinned && parsed ? parsed.folderPath.join('/') : ''
            };
        } else {
            return;
        }

        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', runtime.drag.type);
        }
    }, { signal: abort.signal });

    scrollArea.addEventListener('dragover', (e) => {
        if (!runtime.drag || runtime.moving) return;

        const target = resolveDropTarget(e.target);
        if (!canDrop(runtime.drag, target)) {
            clearDropHighlight();
            return;
        }

        e.preventDefault();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
        highlightDropTarget(target);
    }, { signal: abort.signal });

    scrollArea.addEventListener('dragleave', (e) => {
        if (!scrollArea.contains(e.relatedTarget)) {
            clearDropHighlight();
        }
    }, { signal: abort.signal });

    scrollArea.addEventListener('drop', (e) => {
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

    scrollArea.addEventListener('dragend', () => {
        runtime.drag = null;
        clearDropHighlight();
    }, { signal: abort.signal });
}
