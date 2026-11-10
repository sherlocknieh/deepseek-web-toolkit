// 把 "工作/项目A/讨论" 拆成文件夹路径 [工作, 项目A] 和会话名 讨论；
// 不含 "/" 的会话不归类
export function parseChatPath(title) {
    const parts = title.split('/').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) {
        return null;
    }

    const chatName = parts.pop();
    return { folderPath: parts, chatName };
}

// 把 "/" 路径规范成目录段数组：去掉空段和首尾空白，供新建文件夹使用
export function normalizeFolderPath(raw) {
    return String(raw || '')
        .split('/')
        .map(segment => segment.trim())
        .filter(Boolean)
        .join('/');
}

// 用同一父容器里的斜杠会话构建前缀树；路径相同的会话共用一个文件夹节点。
// extraFolders 是手动新建、暂时没有会话的目录路径，先建出占位节点，等会话拖入后自然合并
export function buildTree(chats, extraFolders = []) {
    const root = { name: '', path: '', children: new Map(), chats: [] };

    const ensureNode = folderPath => {
        let node = root;
        for (const segment of folderPath) {
            let child = node.children.get(segment);
            if (!child) {
                child = {
                    name: segment,
                    path: node.path ? node.path + '/' + segment : segment,
                    children: new Map(),
                    chats: []
                };
                node.children.set(segment, child);
            }
            node = child;
        }
        return node;
    };

    extraFolders.forEach(path => {
        const folderPath = String(path || '').split('/').filter(Boolean);
        if (folderPath.length) {
            ensureNode(folderPath);
        }
    });

    chats.forEach(chat => {
        ensureNode(chat.folderPath).chats.push(chat);
    });

    return root;
}

// 目录名和叶子会话名共用的排序规则：中文按拼音、数字按大小
export function compareName(a, b) {
    return a.localeCompare(b, 'zh-CN', { numeric: true });
}

// 同级文件夹按名称排序
export function compareFolder(a, b) {
    return compareName(a.name, b.name);
}
