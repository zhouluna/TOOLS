# 端点台

把 NVIDIA 目录里标记为 **Free Endpoint** 的模型收在一个页面里：左边检索，右边看接口或直接对话。聊天使用你自己的 NVIDIA API Key，Key 不写入数据库。

免费标识只说明目录当时这么标记，不代表无限调用或永久免费。发出去的内容会到达 NVIDIA。

## 本地运行

需要 Node.js 22 或更高版本。

Windows 上把项目放在 `G:\TOOLS` 后，双击 `运行.bat`。它会在缺少依赖时执行 `npm install`，然后启动本机页面。

也可以在项目目录里手动执行：

```bash
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:4179](http://127.0.0.1:4179)。开发服务只监听本机。

1. 点「同步目录」。首次若已带目录快照，列表会先显示快照，同步在后台核对官网接口。
2. 打开「设置」，填入从 [build.nvidia.com/settings](https://build.nvidia.com/settings) 生成的 `nvapi-` Key，可先「测试连接」。
3. 选一个「可聊天」模型发送消息。Enter 发送，Shift+Enter 换行，生成中可以停止。
4. 换模型时默认新开对话；只有点「沿用已有内容」才会把旧消息发给新模型。
5. 「接口」页可以复制 POST 地址和示例。示例里的密钥是 `$NVIDIA_API_KEY`。

聊天记录默认不落库。打开设置里的「保存聊天记录」后，记录按这台浏览器的身份标记存在本机 SQLite（`data/catalog.db`）。可以单条删除，也可以全部删除。

同步默认每 24 小时一次，只在应用运行时执行。失败会保留上一次成功的目录。模型第一次从完整同步里消失时标为疑似下线，下一次完整同步仍没有时标为已下线，历史不删除。

## 目录从哪来

- 模型列表：NVIDIA NGC 公开目录搜索，筛 `Free Endpoint` 标签。
- 接口地址和模型 ID：对应的 build.nvidia.com 模型页。对不上页面上的官方写法时标为待确认，不按名字猜测。
- 聊天只转发到已确认的 `https://integrate.api.nvidia.com` 或 `https://ai.api.nvidia.com` 地址。

更新随仓库提交的快照：

```bash
npm run snapshot
```

## 检查

```bash
npm test
npm run lint
```
