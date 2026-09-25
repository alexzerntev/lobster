# Theme and font notices

This directory contains the standalone Lobster viewer's theme. It has no
runtime imports from OpenClaw and serves all artwork and fonts locally.

## Adapted theme and artwork

`theme.css` is a reduced adaptation of OpenClaw's `ui/src/styles/base.css`,
`layout.css`, `layout.mobile.css`, `components.css`, `settings-controls.css`,
and `theme-backgrounds.css`. Only the viewer's typography, colors, controls,
canvas geometry, and accessibility styles are retained. Unused application
chrome, components, and theme families are omitted.

`artwork/dark.webp` and `artwork/light.webp` are unmodified copies of
`ui/src/assets/themes/claw-dark.webp` and `claw-light.webp` respectively.

Source: [OpenClaw at 5b384871ea6231ca9e960a883e7a0bcc7beb7a85](https://github.com/openclaw/openclaw/tree/5b384871ea6231ca9e960a883e7a0bcc7beb7a85/ui).

MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Fonts

The WOFF2 files are the unmodified Latin and Latin Extended subsets distributed
in OpenClaw's `ui/public/fonts/` at the same revision. Each family includes normal
and italic variable faces at weights 400–700. The accompanying CSS retains the
source Unicode ranges. No font services are contacted at runtime.

- **Instrument Sans**: Copyright 2022 The Instrument Sans Project Authors.
  [Upstream](https://github.com/Instrument/instrument-sans).
  Licensed under the SIL Open Font License 1.1; complete license and copyright
  notice: [fonts/instrument-sans-OFL.txt](fonts/instrument-sans-OFL.txt).
- **JetBrains Mono**: Copyright 2020 The JetBrains Mono Project Authors.
  [Upstream](https://github.com/JetBrains/JetBrainsMono).
  Licensed under the SIL Open Font License 1.1; complete license and copyright
  notice: [fonts/jetbrains-mono-OFL.txt](fonts/jetbrains-mono-OFL.txt).
