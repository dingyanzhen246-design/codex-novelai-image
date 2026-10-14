---
name: novelai-image
description: Use the local NovelAI plugin to configure the API Token, manage artist/style strings, select a current style, compose prompts, and generate images. Use when the user asks for NovelAI images, artist strings, presets, or current-style generation.
---

# NovelAI 图片插件

Use the `novelai_image` MCP server for all NovelAI operations. The server has a settings UI resource and also exposes headless tools for Codex.

## Behavior

- The API Token is stored locally and is never returned by tools.
- The artist library is stored in this plugin's own directory by default, in `artists.json`. It is intentionally separate from the DSH plugin's library.
- `selectedStyleId` in that file is the current style.
- If the user does not specify a style during generation, use the current selected style automatically.
- Preserve manually entered `artistText` exactly. Do not add or normalize weights, `artist:`, spaces, or punctuation.
- NovelAI generation is a paid/external API operation. Only call `nai_generate_image` after the user asks to generate.

## Tools

- `nai_settings_get` / `nai_settings_save`: inspect or save token configuration without exposing the token.
- `nai_style_list`, `nai_style_get`, `nai_style_save`, `nai_style_select`, `nai_style_delete`: manage the local style file.
- `nai_compose_prompt`: show the effective prompt using an explicit or current style.
- `nai_generate_image`: generate one PNG. Omit `style` to use the current style.

When the user asks for the interface, call `nai_open_settings` so the host can render the API and artist-style panel. If the host does not render the UI, complete the same workflow with the headless tools.
