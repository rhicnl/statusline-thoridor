# Rosé Pine Moon — color scheme reference

Palette used by `thoridor.py`. Source: <https://rosepinetheme.com/palette/> (Moon variant).

## Palette

| Role    | Hex       | RGB           |
|---------|-----------|---------------|
| base    | `#232136` | 35, 33, 54    |
| surface | `#2a273f` | 42, 39, 63    |
| overlay | `#393552` | 57, 53, 82    |
| muted   | `#6e6a86` | 110, 106, 134 |
| subtle  | `#908caa` | 144, 140, 170 |
| text    | `#e0def4` | 224, 222, 244 |
| love    | `#eb6f92` | 235, 111, 146 |
| gold    | `#f6c177` | 246, 193, 119 |
| rose    | `#ea9a97` | 234, 154, 151 |
| pine    | `#3e8fb0` | 62, 143, 176  |
| foam    | `#9ccfd8` | 156, 207, 216 |
| iris    | `#c4a7e7` | 196, 167, 231 |

## ANSI role mapping (official Rosé Pine terminal table)

How the base gauge's 4-bit ANSI colors were replaced in this variant:

| Gauge role            | Original ANSI | Rosé Pine color | Truecolor escape              |
|-----------------------|---------------|-----------------|-------------------------------|
| Model name            | red           | love            | `\033[38;2;235;111;146m`      |
| Usage ≥ 90%           | bright red    | love (bold)     | `\033[1;38;2;235;111;146m`    |
| Git branch, usage <50%| green         | pine            | `\033[38;2;62;143;176m`       |
| Directory, usage <75% | yellow        | gold            | `\033[38;2;246;193;119m`      |
| Session name          | blue          | foam            | `\033[38;2;156;207;216m`      |
| `#` separator         | magenta       | iris            | `\033[38;2;196;167;231m`      |
| (unused, kept)        | cyan          | rose            | `\033[38;2;234;154;151m`      |
| Empty bar segment     | dim           | muted           | `\033[38;2;110;106;134m`      |

Background tones (`base`, `surface`, `overlay`) and `subtle`/`text` are not used by the
status line (it renders on the terminal's own background) but are listed above for reference.
