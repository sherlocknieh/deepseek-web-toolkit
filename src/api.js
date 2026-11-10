import { getPageWindow } from './runtime.js';
import { applyTitleOverride } from './titles.js';

// 读取 DeepSeek 登录 token：localStorage.userToken 是 JSON，兼容纯字符串
function getUserToken() {
    const win = getPageWindow();
    const raw = win.localStorage.getItem('userToken') || '';
    try {
        const parsed = JSON.parse(raw);
        return parsed.value || parsed.token || raw;
    } catch (e) {
        return raw;
    }
}

// 用页面上下文的 fetch，保证同源 Cookie 和应用自身请求一致
function pageFetch(url, options) {
    const win = getPageWindow();
    const f = win && win.fetch ? win.fetch : fetch;
    return f.call(win || undefined, url, options);
}

// 读取服务端会话标题：改名后用来确认补回的目录前缀没有被晚到的请求覆盖
export async function fetchServerTitle(chatId) {
    const token = getUserToken();
    if (!token) return null;

    const res = await pageFetch('/api/v0/chat_session/fetch_page?count=100', {
        headers: {
            'Authorization': 'Bearer ' + token
        }
    });

    let json = null;
    try {
        json = await res.json();
    } catch (e) {
        return null;
    }

    const list = (json && json.data && json.data.biz_data && json.data.biz_data.chat_sessions) || [];
    const row = list.find(session => session.id === chatId);
    return row ? row.title : null;
}

// 调用 DeepSeek 自己的重命名接口改路径；成功后再更新本地显示
export async function renameChat(chatId, fromTitle, toTitle) {
    const token = getUserToken();
    if (!token) {
        throw new Error('未找到登录 token，请刷新页面后重试');
    }

    const res = await pageFetch('/api/v0/chat_session/update_title', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
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
        throw new Error('重命名接口返回异常');
    }

    if (!json || json.code !== 0) {
        throw new Error((json && json.msg) || '重命名失败');
    }

    const appliedTitle = (json.data && json.data.biz_data && json.data.biz_data.title) || toTitle;
    applyTitleOverride(chatId, fromTitle, appliedTitle);
    return appliedTitle;
}
