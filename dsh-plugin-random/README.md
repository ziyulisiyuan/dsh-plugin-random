# dsh-plugin-random

CSPRNG-backed random tools for DSH agents. Agents (LLMs) cannot produce
trustworthy randomness — invented values are biased, unauditable, and often
fall outside the requested range. This bundle registers five `random_*`
tools plus a standing system-prompt section so agents reach for real random
sources automatically.

## Tools

| Tool | Purpose |
| --- | --- |
| `random_number` | Uniform numbers in `[min, max]`; `integer` or float; `count` batch; optional `seed` (reproducible, **not** cryptographic) |
| `random_string` | Exactly `length` characters from named `sets` (`digits`, `lower`, `upper`, `hex`, `symbols`, union + dedupe) or a literal `chars` alphabet (any Unicode) |
| `random_bytes` | `length` secure bytes, `hex` / `base64` / `base64url` |
| `random_uuid` | UUID v4 (RFC 9562) |
| `random_shuffle` | Unbiased Fisher-Yates shuffle, returns a new array |

Range/alphabet validation lives in the tools: they return an explicit error
for `min > max`, empty alphabets, or out-of-cap sizes — the model only
passes parameters and reads results.

## Randomness source

Node's `node:crypto` (`randomInt` with rejection sampling — no modulo bias,
`randomBytes` with a 53-bit uniform float mapping, `randomUUID`). On Windows
the entropy source is `BCryptGenRandom`. The only non-CSPRNG path is the
`seed` mode (`mulberry32`), intended for reproducible simulations and tests;
never use seeded output for keys, nonces, or passwords.

## Install

From a DSH session:

```
plugin_manager  →  action: install_bundle  →  target: <absolute path to this directory>
```

or place this directory under `$DSH_HOME/plugins/` and install from there.

## Develop

```
node --check index.js
node test.mjs
```

`test.mjs` runs offline: range containment, loose chi-square uniformity
(guards against modulo-bias regressions), charset membership, seed
reproducibility, permutation integrity, and error paths.

## License

MIT
