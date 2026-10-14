# Codex NovelAI 图片插件

这是一个独立的 Codex 本地插件，提供 NovelAI API Token 设置、画师串/风格库管理、当前画师串选择和生图工具。

## 数据

- API Token：`%USERPROFILE%\.codex\secrets\novelai_token.txt`
- 画师串：默认使用本插件目录下的 `artists.json`，与 DSH 插件的画师库分离
- 图片：`%USERPROFILE%\.codex\nai-images\`
- 在支持 MCP Extensions 的客户端中，插件侧边栏会提供“NovelAI 图片”入口，可直接打开设置界面；不支持该入口的客户端仍可调用 `nai_open_settings`。
- 如果当前 Codex 页面不显示自定义设置入口，可双击插件目录中的 `打开 NovelAI 设置.cmd`，在独立窗口直接填写 Token 和画师串，不需要发送对话指令。

画师串中的 `artistText` 会按用户输入原文保存。生成时省略 `style` 参数会自动使用 JSON 中的 `selectedStyleId`。

## Codex 安装

本机已添加 `codex-local` marketplace，并启用 `codex-novelai-image`。完全重启 Codex 后，在插件列表中刷新即可看到“NovelAI 图片”。

插件目录：`%USERPROFILE%\.codex\codex-novelai-image-plugin`

如果当前 Codex 版本不显示自定义 UI，仍可直接使用插件工具：`nai_settings_save`、`nai_style_list`、`nai_style_save`、`nai_style_select`、`nai_compose_prompt` 和 `nai_generate_image`。
