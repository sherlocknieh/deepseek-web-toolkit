import { BASE_PADDING, INDENT } from './constants.js';
import {
    getScrollArea,
    getOriginalAnchors,
    getAnchorClass,
    getPinnedSection,
    isAnchorPinned,
    setSubtreeHidden,
    markChatRow
} from './dom.js';
import { parseChatPath, normalizeFolderPath, buildTree, compareFolder, compareName } from './path.js';
import { getChatTitle, applyLeafTitle } from './titles.js';
import {
    isExpanded,
    toggleExpanded,
    setExpanded,
    getExtraFolders,
    hasExtraFolder,
    addExtraFolder,
    removeExtraFolder,
    renameExpandedFolders
} from './storage.js';
import { updateSelectedState } from './selection.js';
import { runtime } from './runtime.js';
import { moveFolderSubtree } from './folder.js';

const NEW_FOLDER_BUTTON_ID = 'dscf-new-folder';
const NEW_FOLDER_ROW_ID = 'dscf-new-folder-row';
// 新建行的默认名称：进入命名状态就预填并被全选，直接输入即可替换
const NEW_FOLDER_DEFAULT_NAME = '新文件夹';

// 目录节点（含所有后代）是否还挂着会话；只有手动新建且彻底为空的目录才给删除按钮
function nodeHasChats(node) {
    if (node.chats.length) return true;
    for (const child of node.children.values()) {
        if (nodeHasChats(child)) return true;
    }
    return false;
}

// 给新建的目录展开所有祖先，否则嵌套目录的父级还是折叠的，新行看不见
function expandAncestors(path) {
    const segments = path.split('/');
    for (let i = 1; i < segments.length; i++) {
        setExpanded(segments.slice(0, i).join('/'), true);
    }
}

// 目录是否已经存在：手动新建的空目录，或置顶区里已有会话走过的同一路径/子路径
function folderExists(path) {
    if (hasExtraFolder(path)) return true;

    return getOriginalAnchors().some(anchor => {
        if (!isAnchorPinned(anchor)) return false;
        const parsed = parseChatPath(getChatTitle(anchor));
        if (!parsed) return false;
        const folder = parsed.folderPath.join('/');
        return folder === path || folder.startsWith(path + '/');
    });
}

// 置顶区会话列表的父容器：目录树、新建输入行都挂在这里；没有置顶会话时退回列表容器
function getPinnedListParent(anchors = getOriginalAnchors()) {
    const pinnedSection = getPinnedSection();
    if (!pinnedSection) return null;

    const first = anchors.find(anchor => pinnedSection.contains(anchor) && anchor.parentElement);
    return first ? first.parentElement : pinnedSection.querySelector('._62cad32');
}

// 把焦点交给新建输入行；点击 + 或重复点击时都直接进入输入
function focusNewFolderInput() {
    const input = document.querySelector('#' + NEW_FOLDER_ROW_ID + ' input');
    if (!input) return;
    input.focus();
    input.select();
}

// 提交/取消新建：提交时才写入空目录占位，取消则什么都不留
function finishNewFolder(row, state, input, onToggle, commit) {
    // 行被移除时输入的 blur 会再次触发；只让第一次收尾生效
    if (runtime.newFolder !== state) return;
    runtime.newFolder = null;

    if (commit) {
        const path = normalizeFolderPath(input.value);
        if (path) {
            if (folderExists(path)) {
                // 目录已存在时直接展开它，不生成重复占位
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

// 目录列表末尾的“正在命名”行：目录图标 + 行内输入框，提交前不写存储
function createNewFolderRow(onToggle) {
    const state = runtime.newFolder;

    const row = document.createElement('div');
    row.id = NEW_FOLDER_ROW_ID;
    row.className = 'dscf-new-folder-row';
    // 借用会话行的 class 拿到主题的文字色；body 兜底色是紫色，不挂它输入框会显示成紫色
    const anchorClass = getAnchorClass();
    if (anchorClass) {
        row.classList.add(anchorClass);
    }
    row.style.paddingLeft = BASE_PADDING + 'px';

    const input = document.createElement('input');
    input.className = 'dscf-new-folder-input';
    input.type = 'text';
    input.placeholder = '文件夹名称';
    input.setAttribute('aria-label', '文件夹名称');
    input.value = state.draft || '';
    row.appendChild(input);

    // 记录草稿：React 重渲染把行替换掉后，重建时还能恢复用户已经输入的内容
    input.addEventListener('input', () => {
        if (runtime.newFolder === state) {
            runtime.newFolder.draft = input.value;
        }
    });

    input.addEventListener('keydown', (e) => {
        // 输入法组合阶段的 Enter 是在选词，不当作提交
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finishNewFolder(row, state, input, onToggle, true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finishNewFolder(row, state, input, onToggle, false);
        }
    });

    // 点到别处视为确认；名称为空则什么都不创建
    input.addEventListener('blur', () => finishNewFolder(row, state, input, onToggle, true));

    return row;
}

// 进入新建状态：先让重排在目录树末尾补出输入行，再聚焦
function startNewFolder(onToggle) {
    if (runtime.newFolder) {
        focusNewFolderInput();
        return;
    }

    runtime.newFolder = { draft: NEW_FOLDER_DEFAULT_NAME };
    if (onToggle) onToggle();
    focusNewFolderInput();
}

// 保证输入行存在并挂在当前置顶列表里；返回是否新建了 DOM 行，供重排决定是否强制刷新
export function syncNewFolderEditor(onToggle) {
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

// 移除新建输入行；热更新或停用时由入口登记清理
export function disposeNewFolderEditor() {
    runtime.newFolder = null;
    document.getElementById(NEW_FOLDER_ROW_ID)?.remove();
}

// 在置顶标题行右侧放一个新建按钮；React 重渲染可能把它连同标题一起替换，每次重排都补回
export function syncNewFolderButton(onToggle) {
    const pinnedSection = getPinnedSection();
    const existing = document.getElementById(NEW_FOLDER_BUTTON_ID);

    if (!pinnedSection) {
        if (existing) existing.remove();
        return;
    }

    // 标题行是置顶区里“只有文字、没有会话链接”的直接子元素
    const header = Array.from(pinnedSection.children).find(el =>
        !el.querySelector('a[href^="/a/chat/s/"]') &&
        /^(置顶|Pinned)/.test((el.textContent || '').trim())
    );
    if (!header) return;

    if (existing && existing.parentElement === header) return;
    if (existing) existing.remove();

    const button = document.createElement('button');
    button.id = NEW_FOLDER_BUTTON_ID;
    button.type = 'button';
    button.className = 'dscf-new-folder';
    button.title = '新建文件夹';
    button.setAttribute('aria-label', '新建文件夹');
    button.innerHTML = '<i class="fa-solid fa-plus"></i>';
    button.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startNewFolder(onToggle);
    });

    header.appendChild(button);
}

// 移除新建按钮；热更新或停用时由入口登记清理
export function removeNewFolderButton() {
    document.getElementById(NEW_FOLDER_BUTTON_ID)?.remove();
}

// 进入目录重命名：记下路径和草稿，下一次重排时该行直接渲染成输入框
function startFolderRename(path, name, onToggle) {
    // 正在移动/改名时不开新的编辑，避免两个改路径的操作交叉
    if (runtime.moving) return;
    runtime.folderRename = { path, draft: name, focusPending: true };
    if (onToggle) onToggle();
}

// 提交/取消目录重命名：编辑的是路径最后一段，整棵子树一起换前缀
async function finishFolderRename(path, value, onToggle, commit) {
    const state = runtime.folderRename;
    if (!state || state.path !== path) return;
    runtime.folderRename = null;

    // 允许输入 “父/子” 一次挪到更深的位置；空名称、没改动或把目录改到自己下面都直接收尾
    const parent = path.split('/').slice(0, -1).join('/');
    const name = normalizeFolderPath(value);
    const toPath = parent ? parent + '/' + name : name;
    if (!commit || !toPath || toPath === path || toPath.startsWith(path + '/')) {
        onToggle();
        return;
    }

    runtime.moving = true;
    try {
        await moveFolderSubtree(path, toPath);
        // 展开记录跟到新路径，并展开新路径和祖先，提交后立刻能看到结果
        renameExpandedFolders(path, toPath);
        expandAncestors(toPath);
        setExpanded(toPath, true);
    } catch (err) {
        console.error('DeepSeek 工具箱：重命名文件夹失败', err);
        alert('重命名失败：' + (err && err.message ? err.message : err));
    } finally {
        runtime.moving = false;
        onToggle();
    }
}

// 重命名行重建后把焦点放回输入框；首次进入全选，之后把光标放到末尾
function focusFolderRenameInput() {
    const state = runtime.folderRename;
    const input = document.querySelector('.dscf-folder-rename-input');
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

// 重命名中的目录行内容：输入框顶替目录名，图标和行位置保持不变
function createFolderRenameInput(node, state, onToggle) {
    const input = document.createElement('input');
    input.className = 'dscf-new-folder-input dscf-folder-rename-input';
    input.type = 'text';
    input.value = state.draft;
    input.setAttribute('aria-label', '重命名文件夹');

    // 只改草稿，不触发重排；行被 React 替换后还能恢复已输入的内容
    input.addEventListener('input', () => {
        state.draft = input.value;
    });

    // 点在输入框里不应触发目录行的展开/折叠
    input.addEventListener('click', (e) => e.stopPropagation());

    input.addEventListener('keydown', (e) => {
        // 输入法组合阶段的 Enter 是在选词，不当作提交
        if (e.isComposing || e.keyCode === 229) return;

        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            finishFolderRename(node.path, input.value, onToggle, true);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finishFolderRename(node.path, input.value, onToggle, false);
        }
    });

    // 点到别处视为确认；名称清空或没改则什么都不做
    input.addEventListener('blur', () => finishFolderRename(node.path, input.value, onToggle, true));

    return input;
}

// 丢弃未完成的目录重命名；热更新或停用时由入口登记清理
export function disposeFolderRename() {
    runtime.folderRename = null;
}

// 生成一个可点击的目录行；点击只切换展开状态，不参与会话导航
function createFolderRow(node, depth, expanded, onToggle, deletable) {
    const row = document.createElement('div');
    const anchorClass = getAnchorClass();
    if (anchorClass) {
        row.classList.add(anchorClass);
    }
    row.classList.add('dscf-folder-row');
    if (expanded) {
        row.classList.add('dscf-folder-open');
    }
    row.dataset.path = node.path;
    row.title = node.path;
    row.style.paddingLeft = (BASE_PADDING + depth * INDENT) + 'px';
    row.setAttribute('role', 'button');
    row.setAttribute('aria-expanded', String(expanded));
    row.tabIndex = 0;
    row.draggable = true;

    // 正在重命名的目录：整行内容换成输入框，不参与拖动和折叠点击
    const renameState = runtime.folderRename && runtime.folderRename.path === node.path
        ? runtime.folderRename
        : null;
    if (renameState) {
        row.classList.add('dscf-folder-renaming');
        row.draggable = false;
        row.tabIndex = -1;
        row.removeAttribute('role');
        row.removeAttribute('aria-expanded');
        row.appendChild(createFolderRenameInput(node, renameState, onToggle));
        return row;
    }

    const name = document.createElement('span');
    name.classList.add('dscf-folder-name');
    name.textContent = node.name;
    row.appendChild(name);

    // 目录重命名按钮：点开后在当前行内编辑名称，整棵子树跟着换前缀
    const rename = document.createElement('button');
    rename.type = 'button';
    rename.className = 'dscf-folder-rename';
    rename.title = '重命名文件夹';
    rename.setAttribute('aria-label', '重命名文件夹');
    rename.draggable = false;
    rename.innerHTML = '<i class="fa-solid fa-pen"></i>';
    rename.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        startFolderRename(node.path, node.name, onToggle);
    });
    row.appendChild(rename);

    // 空目录右侧的删除按钮：只删内存占位记录，不动任何会话
    if (deletable) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'dscf-folder-remove';
        remove.title = '删除空文件夹';
        remove.setAttribute('aria-label', '删除空文件夹');
        remove.draggable = false;
        remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        remove.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            removeExtraFolder(node.path);
            onToggle();
        });
        row.appendChild(remove);
    }

    const toggle = () => {
        toggleExpanded(node.path);
        // 展开状态不在签名里，由观察模块强制重排一次
        onToggle();
    };

    row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle();
    });

    row.addEventListener('keydown', (e) => {
        // 只处理行自身获得焦点的情况，避免行内按钮的键盘操作也触发展开/折叠
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
        }
    });

    return row;
}

// 在某个父容器里原地重排：目录行和原始会话项共用 flex order，不移动、不复制会话节点
function renderParent(parent, chats, onToggle, extraFolders = [], extraSet = new Set()) {
    parent.classList.add('dscf-list-parent');

    const chatByAnchor = new Map();
    chats.forEach(chat => chatByAnchor.set(chat.anchor, chat));

    const root = buildTree(chats, extraFolders);
    const originalChildren = Array.from(parent.children);
    let order = 0;

    // 先序遍历目录树：给目录行和叶子会话分配 order，并按父级展开状态决定是否隐藏
    const emitTree = () => {
        const walk = (node, depth, parentVisible) => {
            const expanded = isExpanded(node.path);

            // 手动新建且没有会话的目录才允许删除；已有会话的目录随会话存在
            const deletable = extraSet.has(node.path) && !nodeHasChats(node);
            const row = createFolderRow(node, depth, expanded, onToggle, deletable);
            row.style.order = String(order++);
            if (!parentVisible) {
                setSubtreeHidden(row, true);
            }
            parent.appendChild(row);

            const childVisible = parentVisible && expanded;

            Array.from(node.children.values()).sort(compareFolder).forEach(child => {
                walk(child, depth + 1, childVisible);
            });

            // 同一目录里的叶子按会话名排序，不再沿用应用给的最近更新顺序
            node.chats.slice().sort((a, b) => compareName(a.chatName, b.chatName)).forEach(chat => {
                const anchor = chat.anchor;
                markChatRow(anchor, true);
                anchor.style.order = String(order++);
                anchor.style.paddingLeft = (BASE_PADDING + (depth + 1) * INDENT) + 'px';
                setSubtreeHidden(anchor, !childVisible);
            });
        };

        Array.from(root.children.values()).sort(compareFolder).forEach(node => walk(node, 0, true));
    };

    // 文件夹整体优先：目录行和叶子先按树输出，根级会话与占位元素再按原有相对次序排在后面
    emitTree();

    // 新建输入行跟在整个目录树的末尾，位于根级会话之前
    const newFolderRow = document.getElementById(NEW_FOLDER_ROW_ID);
    if (newFolderRow && newFolderRow.parentElement === parent && runtime.newFolder) {
        newFolderRow.style.order = String(order++);
    }

    originalChildren.forEach(child => {
        // 斜杠会话已经在 emitTree 里分配过 order，这里不再重复处理
        if (chatByAnchor.has(child)) return;
        // 新建输入行的 order 已经单独安排在目录之后
        if (child === newFolderRow) return;

        // 根级会话、分组标题、"更多"占位等：保留原相对位置，但整体排在目录之后
        child.style.order = String(order++);
    });
}

// 清理上一轮插入的目录行，并恢复会话项被改写的 order/缩进/显隐
export function cleanupInPlace() {
    const scrollArea = getScrollArea();
    if (!scrollArea) return;

    scrollArea.querySelectorAll('.dscf-folder-row').forEach(row => row.remove());

    scrollArea.querySelectorAll('.dscf-list-parent').forEach(parent => {
        Array.from(parent.children).forEach(child => {
            child.style.order = '';
            if (child.tagName === 'A') {
                child.style.paddingLeft = '';
                markChatRow(child, false);
                setSubtreeHidden(child, false);
            }
        });
        parent.classList.remove('dscf-list-parent');
    });

    // 兜底：清理所有会话上的临时状态（标记写在 data 属性上，React 重写 class 也不会丢）
    scrollArea.querySelectorAll('a[data-dscf-chat]').forEach(anchor => {
        markChatRow(anchor, false);
        setSubtreeHidden(anchor, false);
        anchor.style.order = '';
        anchor.style.paddingLeft = '';
    });
}

// 收集斜杠会话并按直接父容器分组，在置顶区里原地生成目录
export function renderInPlace(anchors, onToggle) {
    cleanupInPlace();
    syncNewFolderButton(onToggle);

    // 所有原始会话都允许拖动（含无斜杠会话，拖进目录即自动置顶并加前缀）
    anchors.forEach(anchor => {
        anchor.draggable = true;
    });

    // 目录只应用于置顶区；未置顶会话保持平铺，等改名/拖动时再自动置顶
    const pinnedSection = getPinnedSection();

    // 叶子行只显示末段名称；未置顶或未分目录的会话恢复完整标题
    anchors.forEach(anchor => {
        const fullTitle = getChatTitle(anchor);
        const parsed = parseChatPath(fullTitle);
        const showLeaf = !!pinnedSection && pinnedSection.contains(anchor) && !!parsed;
        applyLeafTitle(anchor, fullTitle, showLeaf);
    });

    if (!pinnedSection) {
        updateSelectedState();
        return;
    }

    // 空目录挂在置顶区第一个会话的父容器里；即使还没有斜杠会话，手动新建的目录也要能显示
    const firstPinned = anchors.find(anchor => pinnedSection.contains(anchor) && anchor.parentElement);
    const pinnedParent = firstPinned ? firstPinned.parentElement : null;
    const extraFolders = getExtraFolders();
    const extraSet = new Set(extraFolders);

    const groups = new Map();
    if (pinnedParent) {
        groups.set(pinnedParent, []);
    }

    anchors.forEach(anchor => {
        if (!pinnedSection.contains(anchor)) return;

        const title = getChatTitle(anchor);
        const parsed = parseChatPath(title);
        if (!parsed || !anchor.parentElement) return;

        const parent = anchor.parentElement;
        if (!groups.has(parent)) {
            groups.set(parent, []);
        }
        groups.get(parent).push({
            anchor,
            title,
            folderPath: parsed.folderPath,
            chatName: parsed.chatName
        });
    });

    // 手动新建的空目录只放在主容器的树里，避免置顶区若有多个容器时重复出现
    groups.forEach((chats, parent) => {
        renderParent(parent, chats, onToggle, parent === pinnedParent ? extraFolders : [], extraSet);
    });

    // 目录行是每次重排重建的，重命名输入框挂上去之后再把焦点交回来
    focusFolderRenameInput();
    updateSelectedState();
}
