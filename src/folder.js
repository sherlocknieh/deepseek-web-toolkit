import { getOriginalAnchors, getChatIdFromHref, isAnchorPinned } from './dom.js';
import { getChatTitle } from './titles.js';
import { parseChatPath } from './path.js';
import { renameChat } from './api.js';
import { renameExtraFolders } from './storage.js';

// 把目录整棵子树的置顶会话改到新路径；拖动整个目录和重命名目录共用这条路径。
// 目录没有实体，会话标题就是唯一事实来源，所以改完标题路径自然就变了。
// 调用方：drag.js 的 handleDrop、render.js 的 finishFolderRename。
export async function moveFolderSubtree(fromPath, toPath) {
    if (!fromPath || !toPath || fromPath === toPath) return 0;

    const moves = getOriginalAnchors()
        .map(anchor => {
            if (!isAnchorPinned(anchor)) return null;

            const title = getChatTitle(anchor);
            const parsed = parseChatPath(title);
            if (!parsed) return null;

            const path = parsed.folderPath.join('/');
            if (!(path === fromPath || path.startsWith(fromPath + '/'))) return null;

            return {
                chatId: getChatIdFromHref(anchor),
                title,
                // 用解析后的路径计算相对路径，避免原始标题里的空格影响截取
                rest: [path.slice(fromPath.length + 1), parsed.chatName].filter(Boolean).join('/')
            };
        })
        .filter(Boolean);

    // 逐个改名，任何一条失败都会抛出，由调用方提示并重排回真实状态
    for (const move of moves) {
        const newTitle = toPath + '/' + move.rest;
        if (newTitle !== move.title) {
            await renameChat(move.chatId, move.title, newTitle);
        }
    }

    // 目录子树里手动新建、还没有会话的空子目录也要跟着换路径
    renameExtraFolders(fromPath, toPath);
    return moves.length;
}
