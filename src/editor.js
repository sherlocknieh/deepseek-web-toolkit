import {
    getRenameEditor,
    getOriginalAnchors,
    getChatIdFromHref,
    getRawTitle,
    isSubtreeHidden,
    setSubtreeHidden
} from './dom.js';
import { parseChatPath } from './path.js';
import { renameChat, fetchServerTitle } from './api.js';
import { runtime } from './runtime.js';

// 正在进行的改名会话：应用会用输入框顶替会话行，这里记下被顶替的会话信息
let session = null;

// 改名提交后要等应用回写标题、再补回目录前缀；这段时间不重排，
// 避免恢复出来的会话行先跳到列表顶部再归位
let restoring = 0;

export function isRestoringTitle() {
    return restoring > 0;
}

// 上一帧看到的会话信息：行被输入框顶替后就没法从 DOM 反推它的路径和位置了
const lastChats = new Map();

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 记录当前所有会话的完整标题、目录层级、order 和缩进，供下一次改名定位使用
// 由 observer 在每次重排后调用：行被输入框顶替后就无法再从 DOM 反推这些信息
export function rememberChats(anchors) {
    const next = new Map();

    anchors.forEach(anchor => {
        const chatId = getChatIdFromHref(anchor);
        if (!chatId) return;

        // 只有显示末段名称的叶子行才有 dataset；它才是目录里的会话
        const stored = anchor.dataset ? anchor.dataset.dscfFullTitle : '';
        const parsed = stored ? parseChatPath(stored) : null;

        next.set(chatId, {
            fullTitle: stored || getRawTitle(anchor),
            folderPath: parsed ? parsed.folderPath : null,
            leaf: parsed ? parsed.chatName : null,
            order: anchor.style ? anchor.style.order : '',
            paddingLeft: anchor.style ? anchor.style.paddingLeft : '',
            hidden: isSubtreeHidden(anchor),
            parent: anchor.parentElement
        });
    });

    lastChats.clear();
    next.forEach((info, chatId) => lastChats.set(chatId, info));
}

// 读/写输入框：预填只改显示值，不派发 input 事件，
// 这样应用始终认为名称还是完整路径，用户直接确认时不会发起改名
function readEditorValue(editor) {
    return editor ? (editor.value || '').trim() : '';
}

function writeEditorValue(editor, value, silent = false, select = true) {
    if (!editor) return;

    const proto = Object.getPrototypeOf(editor);
    const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
        desc.set.call(editor, value);
    } else {
        editor.value = value;
    }

    if (!silent) {
        editor.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (select && typeof editor.select === 'function') {
        editor.select();
    }
}

// 输入框顶替了会话行，但没带我们的 flex order，会被排到容器顶部；
// 这里还原本行的 order 和缩进，让它留在原位置
function placeEditor(target) {
    const wrapper = target.wrapper;
    if (!wrapper) return;

    if (target.order) {
        wrapper.style.order = target.order;
    }

    const padding = parseInt(target.paddingLeft, 10);
    if (!Number.isNaN(padding)) {
        // 输入框自身有 10px 内边距，减掉后文字与原来的会话标题对齐
        wrapper.style.paddingLeft = Math.max(0, padding - 10) + 'px';
    }

    if (target.hidden) {
        setSubtreeHidden(wrapper, true);
    }
}

// 目录里的行显示末段名称，输入框也预填末段；
// 应用可能先插空输入框再回填完整路径，所以短时间内按原值重试几次
function fillLeafTitle(target) {
    if (session !== target || target.reverted) return;
    if (!target.folderPath || !target.leaf) return;

    const current = readEditorValue(target.editor);
    if (current === target.fullTitle) {
        writeEditorValue(target.editor, target.leaf, true);
        target.selectedOnce = true;
        return;
    }

    // 用户已经动过输入框（trusted 输入事件）就不再改写；
    // 应用自己预填的就是末段时也全选一次，方便直接输入替换
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
        if (typeof target.editor.select === 'function') {
            target.editor.select();
        }
    }
}

// 根据输入框的完整标题和“刚消失的会话行”定位这次改的是哪个会话
function beginSession(editor) {
    const wrapper = editor.parentElement;
    const parent = wrapper && wrapper.parentElement;
    if (!parent) return null;

    const value = readEditorValue(editor);
    const currentIds = new Set(getOriginalAnchors().map(getChatIdFromHref).filter(Boolean));
    const entries = Array.from(lastChats.entries());
    const sameParent = entries.filter(([, info]) => info.parent === parent);

    // 输入框可能预填完整路径，也可能是应用内存里的末段；两种都要认
    const pool = sameParent.length ? sameParent : entries;
    const titleMatches = pool.filter(([, info]) => info.fullTitle === value || info.leaf === value);
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

    // 区分用户输入和脚本写入：脚本写入是静默的，只有真实输入才 stop 预填
    editor.addEventListener('input', (e) => {
        if (e.isTrusted) {
            target.touched = true;
        }
    }, { signal: target.abort.signal });

    // 名称没改就确认时，先把输入框静默还原成完整路径再交给应用：
    // 应用按“打开时的原始标题”判断变化，这样它会认为没改名，不发起请求
    const revertIfUnchanged = () => {
        if (session !== target || target.reverted) return;
        if (readEditorValue(target.editor) !== target.leaf) return;
        target.reverted = true;
        writeEditorValue(target.editor, target.fullTitle, true, false);
    };

    editor.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') revertIfUnchanged();
    }, { capture: true, signal: target.abort.signal });

    editor.addEventListener('focusout', revertIfUnchanged, { capture: true, signal: target.abort.signal });

    // 应用重渲染可能把受控输入框的值刷回完整路径；编辑期间轻量重试，
    // 用户一旦真实输入就停止，避免抢光标
    target.prefillTimer = setInterval(() => {
        if (session !== target || target.touched) return;
        fillLeafTitle(target);
    }, 500);

    return target;
}

// 等应用把会话行和改名后的标题渲染回来；又进入新一轮编辑时放弃这次收尾
async function waitForEditedTitle(target, timeout = 4000) {
    const deadline = Date.now() + timeout;
    let last = '';
    let stable = 0;

    while (Date.now() < deadline) {
        if (getRenameEditor()) return '';

        const anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === target.chatId);
        if (anchor) {
            // 新行没有我们的 order，先按原位置摆好，避免恢复期间跳到顶部
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

// 应用的改名请求可能晚于补前缀的请求落库，把目录前缀覆盖掉；
// 写完等服务端稳定后核对一次标题，仍是末段就再补写一次
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
        // 服务端已是别的完整路径，说明用户又改了目录，不再覆盖
        if (parseChatPath(current)) return;

        try {
            await renameChat(chatId, current, expected);
        } catch (err) {
            console.warn('[DeepSeek 工具箱] 补写目录路径失败', err);
            return;
        }
    }
}

// 应用保存时只会提交输入框里的末段名称，需要把原目录前缀拼回去；
// 用户自己输入了带 “/” 的路径时视为有意改到别的目录，不再干预
async function restoreFolderPrefix(target) {
    restoring += 1;

    try {
        if (!target.folderPath) return;
        if (getRenameEditor()) return;

        const raw = await waitForEditedTitle(target);
        if (!raw || raw === target.fullTitle) return;
        if (parseChatPath(raw)) return;

        // 末段没变：先确认服务端仍是原完整路径；是就说明应用也没有真正改名，直接收尾
        if (raw === target.leaf) {
            let serverTitle = null;
            try {
                serverTitle = await fetchServerTitle(target.chatId);
            } catch (err) {
                serverTitle = null;
            }
            if (serverTitle === target.fullTitle) return;
        }

        const newTitle = target.folderPath.join('/') + '/' + raw;
        const anchor = getOriginalAnchors().find(a => getChatIdFromHref(a) === target.chatId);

        // 先把数据集改成完整路径，避免应用回写末段名称时会话短暂跳出行
        if (anchor && anchor.dataset) {
            anchor.dataset.dscfFullTitle = newTitle;
        }

        try {
            await renameChat(target.chatId, raw, newTitle);
        } catch (err) {
            console.warn('[DeepSeek 工具箱] 恢复目录路径失败', err);
            if (anchor && anchor.dataset) {
                delete anchor.dataset.dscfFullTitle;
            }
            return;
        }

        // 补写已经成功，即使核对失败也保留本地完整路径
        await ensureServerTitle(target.chatId, newTitle);
    } finally {
        restoring -= 1;
        // 编辑期间跳过了重排，收尾后统一同步一次；由入口登记在 runtime 上，避免模块循环依赖
        if (!restoring) {
            runtime.rebuild ? runtime.rebuild(true) : null;
        }
    }
}

function finishSession(target) {
    if (session === target) session = null;
    if (target.timer) {
        clearTimeout(target.timer);
    }
    if (target.prefillTimer) {
        clearInterval(target.prefillTimer);
    }
    target.abort.abort();
    restoreFolderPrefix(target);
}

// 由列表观察器在每次 DOM 变更时调用：输入框出现时定位并摆回原行、预填末段，
// 消失时补回目录前缀并恢复重排
export function syncRenameEditor() {
    const editor = getRenameEditor();

    if (!editor) {
        if (session) finishSession(session);
        return;
    }

    if (!session) {
        session = beginSession(editor);
    } else {
        session.editor = editor;
        session.wrapper = editor.parentElement;
    }

    if (!session) return;

    placeEditor(session);
    fillLeafTitle(session);
}

// 脚本停用或热更新时断开监听并丢弃未完成的改名会话
export function disposeRenameEditor() {
    if (!session) return;
    if (session.timer) {
        clearTimeout(session.timer);
    }
    if (session.prefillTimer) {
        clearInterval(session.prefillTimer);
    }
    session.abort.abort();
    session = null;
}
