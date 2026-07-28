# @occupancy/uid

Generates unique identifiers using the
[Snowflake ID](https://en.wikipedia.org/wiki/Snowflake_ID) scheme, encoded in
Base-62. Every ID is exactly 11 alphanumeric characters.

Reach for this when you need a stable key that is safe to put in a filename,
a URL, or a DOM id, and that sorts roughly by creation time. `ui/` uses it to
identify markers placed on a layout.

## Interface

See [`src/index.ts`](src/index.ts) — that file is the package's public surface.
Anything not exported there is internal and may change without notice. Per-
symbol documentation lives on the declarations in `src/uid.ts`, where your
editor will show it on hover.

The convention and the reasoning behind it are in [`../CLAUDE.md`](../CLAUDE.md).

## Use it

This is a private workspace package — it is never published. Depend on it from
another package in this monorepo:

```json
"dependencies": {
  "@occupancy/uid": "workspace:*"
}
```

## Example

```typescript
import { make_id } from '@occupancy/uid';

const id = make_id();   // "06XpY42i7es"
const id2 = make_id(1); // node 1, for a second generator
```

## How the IDs are built

63 bits, laid out as:

| Bits | Field | Range |
| ---: | :--- | :--- |
| 41 | timestamp, ms since 2024-01-01 | ~69 years |
| 10 | node id | 0–1023 |
| 12 | sequence within the millisecond | 0–4095 |

So a single node can mint 4,096 IDs per millisecond; past that it spins until
the clock advances. Distinct `nodeId`s never collide with each other, which is
what makes the scheme safe across independent generators.

Two consequences worth knowing: IDs are **time-ordered but not secret** — they
leak creation time and node — and `make_id()` **throws if the system clock
moves backwards**, rather than risk issuing a duplicate.
