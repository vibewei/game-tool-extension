# 游戏连点 & 网络异常助手

面向 H5 / Cocos 网页游戏的测试小工具，提供两件事：

1. **连点**：设定点击次数后，在游戏里手动点 1 次，自动补点到设定次数；支持 Pointer / 鼠标 / 触摸 / 真实输入（调试器）。
2. **网络场景**：一键模拟 正常 / 弱网 / 强弱网 / 抖动 / 丢包 / 高延迟 / 断网 / 断网10s / 自定义，支持 `Alt+Shift+1~8` 组合快捷键。

插件面板底部带「检查更新」按钮，可直接查询本仓库版本并提示升级；「连点设置」「网络场景」两个区块可分别收起/展开，收起后的胶囊可点 × 隐藏。插件基于 Chrome / Edge 扩展（Manifest V3），默认不显示面板，通过浏览器扩展图标、`Alt+G` 或 `F8` 唤起。

![面板预览](extension/docs/preview.jpg)

## 目录结构

```
├── extension/                  # 插件源码（手动加载这个目录）
├── launcher/                   # 一键启动器（推荐给测试同事，不需要安装扩展）
├── dist/game-tool-extension.zip# 自动更新用的插件压缩包
├── version.json                # 代码仓库检查更新用
└── README.md
```

## 方式一：手动加载扩展（Chrome / Edge）

1. 下载本仓库的 `extension/` 文件夹
2. 打开 `chrome://extensions`（Edge 为 `edge://extensions`）
3. 打开「开发者模式」→「加载已解压的扩展程序」→ 选择 `extension` 文件夹
4. 打开任意页面后默认不显示，按 `F8` / `Alt+G` 或点扩展图标打开

> Chrome 137+ 已不支持命令行 `--load-extension`，但上面的手动加载方式不受影响。

## 方式二：一键启动器（推荐，无需安装扩展）

`launcher/` 是分发包：

1. 双击 `启动游戏助手.bat`
2. 自动把最新插件同步到本机，并用独立 Edge 配置打开游戏
3. 不需要装扩展、不需要重新加载；登录状态会保存在独立配置里

更新：双击 `launcher/检查更新.bat`，会读取本仓库的 `version.json` 并自动下载安装。也可以在 `launcher/config.json` 里把 `autoCheck` 设为 `true`，启动时自动检查。

> Chrome 用户：首次双击 `launcher/首次安装到Chrome.bat` 按提示手动加载一次；以后双击 `launcher/更新并重启Chrome.bat` 自动同步并重启 Chrome。

详细说明见 [`launcher/使用说明.md`](launcher/使用说明.md)。

## 检查更新原理

扩展本身不能从仓库热更新（Chrome 限制），所以更新检查在启动器里完成：

```
version.json（本仓库根目录）
        │  GET https://raw.githubusercontent.com/vibewei/game-tool-extension/main/version.json
        ▼
launcher/update.ps1  → 比较版本 → 下载 dist/game-tool-extension.zip → 解压覆盖本机插件 → 重启后生效
```

`version.json` 格式：

```json
{
  "version": "1.5.2",
  "zipUrl": "https://raw.githubusercontent.com/vibewei/game-tool-extension/main/dist/game-tool-extension.zip",
  "pageUrl": "https://github.com/vibewei/game-tool-extension"
}
```

发新版时：更新 `extension/` 和 `dist/game-tool-extension.zip`，改 `version.json` 的版本号，提交即可；启动器用户下次检查更新会自动升级。

## 配置

`launcher/config.json` 可改：

- `gameUrl`：启动后打开的游戏地址（默认指向测试环境）
- `sourceDir`：插件更新源，留空使用启动器自带的 `game-tool-extension`
- `update.versionUrl` / `update.zipUrl` / `update.autoCheck`：代码仓库检查更新相关

扩展的连点/网络设置保存在浏览器扩展存储里，换页面不丢失。

## 注意

- 仅供测试环境使用；高次数连点前请确认点击位置不会触发真实支付、抽卡等不可逆操作。
- 仓库里不包含任何测试账号/密码，请使用自己的测试账号登录。
- 断网只影响当前页面里的游戏请求，不会修改系统网络。
