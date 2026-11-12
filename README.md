
## DeepSeek 网页端工具箱 - LaTeX 公式复制 & 会话文件夹 & 消息导航 & 折叠思考

安装地址: https://github.com/sherlocknieh/deepseek-web-toolkit/raw/main/dist/deepseek-web-toolkit.user.js

- 公式复制修正

修复 DeepSeek 网页端 LaTeX 公式复制问题:

DeepSeek 网页端复制公式得到的是混乱的文本，而不是 LaTeX 源码。

脚本注入 KaTeX 官方的 copy-tex，复制时得到 LaTeX 源码

- 会话文件夹

支持用文件夹管理会话历史

原理是把会话标题改为路径格式, 例如「工作/项目A/讨论」, 然后渲染为文件夹结构, 方便管理和查找。

- 消息导航

会话内消息过多时, 可以通过消息导航快速跳转到指定提问。

DeepSeek / ChatGPT / Grok / Gemini 等站点都使用脚本的通用导航, 形态与 DeepSeek 原生导航一致: 会话右侧一颗毛玻璃胶囊, 收起时只有一列短横线, 悬停展开成提问列表（只列你的提问, 不列回答）, 点击跳到对应提问。每个站点按自己的页面结构识别消息块, 深色主题自动跟随。

DeepSeek 的原生导航被隐藏, 由通用导航完全接替; 脚本给消息区补右内边距避免重叠。

同时支持 deepseek, chatgpt, grok, gemini 网页端;

- 默认折叠思考

每次打开对话, DeepSeek 会默认展开思考, 占用较多屏幕空间, 现在可以默认折叠思考: 已完成的思考块自动收起, 正在输出的思考保持展开, 手动点开过的块不再被收起。
