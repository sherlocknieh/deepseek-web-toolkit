import { runtime } from './runtime.js';
import { getScrollArea, getOriginalAnchors, getRenameEditor } from './dom.js';
import { getChatTitle, syncTitleOverrides, detectUnpinnedFolderRename } from './titles.js';
import { renderInPlace, syncNewFolderButton, syncNewFolderEditor } from './render.js';
import { syncRenameEditor, isRestoringTitle, rememberChats } from './editor.js';

// 给每个会话元素分配稳定标识，元素被 React 重建时能触发重排
const anchorKeys = new WeakMap();
let anchorKeySeq = 0;

function getAnchorKey(anchor) {
    let key = anchorKeys.get(anchor);
    if (!key) {
        key = 'a' + (++anchorKeySeq);
        anchorKeys.set(anchor, key);
    }
    return key;
}

// 签名包含父容器归属、元素标识和标题，用来判断是否需要重排
function makeSignature(anchors) {
    const parents = [];

    return anchors.map(anchor => {
        let parentIndex = parents.indexOf(anchor.parentElement);
        if (parentIndex === -1) {
            parentIndex = parents.length;
            parents.push(anchor.parentElement);
        }
        return parentIndex + ':' + getAnchorKey(anchor) + ':' + getChatTitle(anchor);
    }).join('\n');
}

// 记录上次签名，跳过与目录无关的 DOM 变动，避免反复重排
let lastSignature = null;

export function rebuild(force = false) {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    // React 重渲染可能把标题行连同按钮、新建输入行一起替换；签名不变时也要补回来
    syncNewFolderButton(() => rebuild(true));
    const editorRecreated = syncNewFolderEditor(() => rebuild(true));

    // 改名输入框打开期间保持现有布局：应用此时用输入框顶替了会话行，
    // 重排会把它当成新元素排到容器顶部，等编辑结束收尾后再重排
    if (getRenameEditor() || isRestoringTitle()) return;

    const anchors = getOriginalAnchors();
    syncTitleOverrides(anchors);
    detectUnpinnedFolderRename(anchors);

    const signature = makeSignature(anchors);
    // 输入行刚被重建时需要重排一次，把它的 order 放回目录末尾
    if (!force && !editorRecreated && signature === lastSignature) return;

    lastSignature = signature;
    renderInPlace(anchors, () => rebuild(true));
    // 重排后记下每行的完整标题和 order，改名时行被输入框顶替就靠这份快照定位
    rememberChats(getOriginalAnchors());
}

// 监听侧栏会话的增删和标题文本变化，防抖后重排
export function observeChatList() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    const schedule = () => {
        // 重命名输入框的出现/消失要立即处理，不能等防抖，否则预填和收尾都会慢一拍
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
