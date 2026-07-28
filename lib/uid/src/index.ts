// Public interface of @occupancy/uid.
//
// This file is the package's interface — the only surface consumers may rely
// on. Anything not exported here is internal and may change without notice.
// Per-symbol documentation lives on the declarations in ./uid.ts, because
// TypeScript discards doc comments written on re-export statements.

//── ID generation ────────────────────────────────────────────────────────────
// Time-ordered, collision-resistant 11-character identifiers.
export { make_id } from './uid.ts';

// Withheld: `toBase62`. It is a numeric encoding helper, not an identity
// concept — exporting it invites callers to mint IDs that bypass the
// timestamp/node/sequence structure `make_id` guarantees. Tests import it
// directly from './uid.ts'.
