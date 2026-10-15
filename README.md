# dsh-plugin-random

> CSPRNG-backed random tools for DSH (DeepSeek Harness) agents: uniform numbers in a range, custom-length strings from chosen character sets, secure bytes, UUID v4, and unbiased shuffles — exposed as agent tools so the model never invents random values.

LLM 无法产生可信随机数：凭空写出的值有偏、不可审计，还经常越出给定区间。本插件把随机数生成交给系统 CSPRNG，并以工具形式暴露给 Agent；同时注入一条常驻系统提示，让 Agent 在需要随机值时直接调用，无需用户提醒。

适用于：抽签、抽样、验证码、密码、密钥、ID、nonce、洗牌、造测试数据、可复现的模拟。
不适用于：用 `seed` 生成需要保密的值（见下文「随机性说明」）。

## 工具

| 工具 | 用途 |
| --- | --- |
| `random_number` | `[min, max]` 内均匀分布的数；整数或浮点；支持批量；支持 `seed` 复现 |
| `random_string` | 定长随机字符串，字符集可自选（命名集合或任意 Unicode 字面量） |
| `random_bytes` | N 字节安全随机数，hex / base64 / base64url 编码 |
| `random_uuid` | UUID v4（RFC 9562，版本位与变体位正确） |
| `random_shuffle` | Fisher-Yates 无偏洗牌，返回新数组，不改原数组 |

## 参数

### `random_number`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `min` | number | 是 | — | 区间下界（含） |
| `max` | number | 是 | — | 区间上界（整数模式含；浮点模式不含） |
| `integer` | boolean | 否 | `true` | `true` 返回整数，`false` 返回浮点 |
| `count` | integer | 否 | `1` | 批量个数，1–10000，互相独立 |
| `seed` | integer | 否 | — | uint32 种子，同种子同参数结果逐位一致；非密码学级 |

```
random_number({ "min": 1, "max": 6, "count": 3 })      → 2, 5, 1
random_number({ "min": 0, "max": 1, "integer": false }) → 0.4713...
random_number({ "min": 1, "max": 100, "count": 4, "seed": 42 }) → 可复现
```

### `random_string`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `length` | integer | 是 | — | 字符数，1–4096（按码点计，emoji 算 1 个） |
| `sets` | string[] | 否 | `["lower","upper","digits"]` | 命名集合取并集去重：`digits` `lower` `upper` `hex` `symbols` |
| `chars` | string | 否 | — | 字面量字符集，任意 Unicode；给出时覆盖 `sets` |

逐字符等概率：选 `["lower","digits"]` 时 36 个字符每个概率相同（字母整体出现率自然高于数字）。

```
random_string({ "length": 6, "sets": ["digits"] })                    → 验证码
random_string({ "length": 32, "sets": ["lower","upper","digits","symbols"] }) → 强密码
random_string({ "length": 16, "sets": ["hex"] })                      → 32 位 hex 等价 16 字节
random_string({ "length": 8, "chars": "ABCDEF" })                     → 自定义字符集
```

### `random_bytes`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `length` | integer | 是 | — | 字节数，1–4096 |
| `encoding` | string | 否 | `hex` | `hex` / `base64` / `base64url` |

### `random_uuid`

无参数，返回一个 UUID v4 字符串。

### `random_shuffle`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `items` | array | 是 | — | 待洗牌数组（任意 JSON），最多 10000 项 |

## 随机性说明

- **整数**：`crypto.randomInt`，内部为拒绝采样，区间内严格均匀，**无取模偏差**——这是「结果总是落在某几个小区间」这类问题的根因，本插件不做 `random % range`。
- **浮点**：取 53 位随机比特映射到区间，覆盖完整双精度。
- **字符串**：每位独立按拒绝采样取值，逐字符均匀。
- **洗牌**：Fisher-Yates，所有排列等概率。
- **熵源**：Node 内置 `node:crypto`（Windows 上为 `BCryptGenRandom`），跨调用独立。
- **`seed` 是唯一非密码学路径**：使用 mulberry32，用于模拟与测试复现，**不要**用它生成密钥、nonce 或密码。已知边界：区间跨度接近 2³² 时存在格点空隙。
- **大样本才看得出均匀性**：小样本天然成簇，验证请用几千次以上样本做卡方检验，而非肉眼看几十次。

## 自动调用

插件注册工具的同时注入一条系统提示段（`order: 9500`），内容要求 Agent 在需要随机值时调用 `random_*` 工具而非自行编造。因此新会话无需任何配置或提醒，Agent 即可看到并使用这些工具。

## 验证

```
node --check index.js
node test.mjs
```

`test.mjs` 为离线自检，覆盖：区间包含性、卡方均匀性（防取模偏差回归）、负区间、批量、种子复现、字符集并集去重、Unicode 码点、字节编码长度、UUID v4 格式与唯一性、洗牌置换完整性、全部错误路径。

## 错误处理

非法参数由工具直接返回明确错误，不静默钳制、不返回越界值：
`min > max`、`min`/`max` 非有限数、整数模式非安全整数、`count` 超出 1–10000、`length` 超出 1–4096、未知集合名、空字符集、未知编码、`items` 非数组。

## 文件结构

| 文件 | 说明 |
| --- | --- |
| `index.js` | 全部实现：五个工具与系统提示段，零依赖 |
| `cordis.patch.yml` | bundle patch，插入一行插件条目 |
| `package.json` | 清单，`dsh.bundle.patch` 指向 patch |
| `locale/en.json`, `locale/zh.json` | 插件管理页的标题与描述 |
| `test.mjs` | 离线自检 |

## 兼容性

- DSH / Cordis Host 插件，仅 Host 侧，无浏览器端代码。
- 依赖 `tools` 与 `systemPrompt` 服务（DSH 基础组合自带）。
- 随机源为 Node 内置 `node:crypto`，无第三方依赖，无构建步骤。

## License

MIT
