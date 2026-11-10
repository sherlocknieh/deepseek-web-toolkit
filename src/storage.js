import { EXPANDED_KEY } from './constants.js';
import { getPageWindow } from './runtime.js';

// 兼容不同油猴管理器：优先同步 GM_*，没有（如 Greasemonkey 4）或不可用时退回页面 localStorage
export function storageGet(key, fallback) {
    try {
        if (typeof GM_getValue === 'function') {
            return GM_getValue(key, fallback);
        }
    } catch (e) {
        // 忽略，继续用 localStorage
    }

    try {
        const value = getPageWindow().localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch (e) {
        return fallback;
    }
}

export function storageSet(key, value) {
    try {
        if (typeof GM_setValue === 'function') {
            GM_setValue(key, value);
            return;
        }
    } catch (e) {
        // 忽略，继续用 localStorage
    }

    try {
        getPageWindow().localStorage.setItem(key, value);
    } catch (e) {
        // 存储不可用时放弃，不影响界面
    }
}

// 读 JSON 状态的容错封装：存储损坏时退回空对象，不让入口直接抛错
function readJson(key, fallback) {
    const raw = storageGet(key, null);
    if (!raw) return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

// 展开状态以文件夹路径为键持久化；路径由会话名中的 "/" 推导，或由手动新建的空文件夹提供
const storedExpanded = readJson(EXPANDED_KEY, {});
let EXPANDED = storedExpanded && typeof storedExpanded === 'object' && !Array.isArray(storedExpanded)
    ? storedExpanded
    : {};

export function isExpanded(path) {
    return !!EXPANDED[path];
}

// 新建文件夹后需要主动展开祖先，让新目录立刻可见
export function setExpanded(path, expanded) {
    if (expanded) {
        EXPANDED[path] = true;
    } else {
        delete EXPANDED[path];
    }
    storageSet(EXPANDED_KEY, JSON.stringify(EXPANDED));
}

export function toggleExpanded(path) {
    setExpanded(path, !EXPANDED[path]);
    return !!EXPANDED[path];
}

// 整目录改名时把展开记录迁到新路径，避免重命名后整棵子树突然收起
export function renameExpandedFolders(fromPath, toPath) {
    if (!fromPath || !toPath || fromPath === toPath) return false;

    let changed = false;
    Object.keys(EXPANDED).forEach(key => {
        if (key !== fromPath && !key.startsWith(fromPath + '/')) return;
        delete EXPANDED[key];
        EXPANDED[toPath + key.slice(fromPath.length)] = true;
        changed = true;
    });
    if (changed) storageSet(EXPANDED_KEY, JSON.stringify(EXPANDED));
    return changed;
}

// 手动新建的空文件夹路径只放在内存里：刷新页面后自然消失，不落持久化存储；
// 会话移入后由标题推导，这些记录会被移除
const EXTRA_FOLDERS = new Set();

export function getExtraFolders() {
    return Array.from(EXTRA_FOLDERS);
}

export function hasExtraFolder(path) {
    return EXTRA_FOLDERS.has(path);
}

export function addExtraFolder(path) {
    if (!path || EXTRA_FOLDERS.has(path)) return false;
    EXTRA_FOLDERS.add(path);
    return true;
}

// 删除空文件夹连同它下面手动新建、同样为空的子目录
export function removeExtraFolder(path) {
    let changed = false;
    Array.from(EXTRA_FOLDERS).forEach(item => {
        if (item === path || item.startsWith(path + '/')) {
            EXTRA_FOLDERS.delete(item);
            changed = true;
        }
    });
    return changed;
}

// 会话移入后，目标路径及其祖先已经由标题支撑，不再保留空的占位记录
export function dropExtraFolderChain(path) {
    if (!path) return false;
    const chain = path.split('/');
    let changed = false;
    for (let i = 1; i <= chain.length; i++) {
        if (EXTRA_FOLDERS.delete(chain.slice(0, i).join('/'))) {
            changed = true;
        }
    }
    return changed;
}

// 整目录拖动时同步迁移手动新建的空子目录，保留它们相对父目录的路径
export function renameExtraFolders(fromPath, toPath) {
    if (!fromPath || !toPath || fromPath === toPath) return false;

    let changed = false;
    Array.from(EXTRA_FOLDERS).forEach(item => {
        if (item !== fromPath && !item.startsWith(fromPath + '/')) return;
        EXTRA_FOLDERS.delete(item);
        EXTRA_FOLDERS.add(toPath + item.slice(fromPath.length));
        changed = true;
    });
    return changed;
}
