# Shared Libraries

All written in TypeScript, all consumed as source — nothing here is built or
published. `ui/` and `dataset/` are the only consumers.

* `r49` : `.r49` archive parser and serializer, manifest schema, scale geometry
* `uid` : Snowflake-style unique id generator
* `classifier` : ONNX Runtime image classifier (browser and node targets)

## The interface convention

**Each package's `src/index.ts` is its interface.** It is the C++ `.h` file of
the package: open it and you see the entire public surface, nothing more.

Three rules:

1. **Explicit exports only — never `export *`.** A wildcard makes the surface an
   accident of which files exist. Every exported name is a decision.
2. **`index.ts` contains no implementation.** It re-exports and it comments;
   that's all. Implementation lives in sibling modules (`archive.ts`,
   `base.ts`, `uid.ts`, …).
3. **Not exported from `index.ts` means internal.** Consumers may not rely on
   it and it may change without notice. Tests, which live inside the package,
   may import internals directly.

## Why it is built this way

* **Per-symbol docs go on the declaration, not the header.** TSDoc written
  above an `export { x } from './y'` line is silently discarded — verified
  against the TypeScript language service, which returns empty documentation
  for such a symbol. Put `@param`/`@throws`/units on the declaration in the
  implementation module, where hover and IntelliSense read them. The header
  carries group comments and rationale instead.

* **The zod schemas are withheld deliberately.** Exporting `ManifestDataSchema`
  and friends would make zod part of `r49`'s public contract, so it could not
  be replaced without a breaking change. Callers receive validated data or an
  exception; how that validation happens is ours to change.

* **There is no `paths` block in the root `tsconfig.json`.** Packages resolve
  through pnpm workspace symlinks and each `package.json` `"exports"` map, so
  `exports` is the single boundary and binds identically at typecheck and at
  bundle time. A `paths` entry — especially a wildcard one — would let deep
  imports typecheck cleanly and then fail only at build.

* **A header cannot hide class members.** `R49Archive` is exported, so all of
  its public methods are public regardless of what `index.ts` says. Narrowing
  a class's surface means `private`, `#field`, or deletion.

* **`classifier` has three entry points, not one.** `.` carries only the config
  type; `./browser` and `./node` carry the classifiers. The split is what keeps
  `onnxruntime-node` and `sharp` out of the browser bundle, so it is load-
  bearing, not stylistic.

## Adding an export

1. Write the TSDoc on the declaration in the implementation module.
2. Name it in that package's `src/index.ts`, under the appropriate group
   comment. If it doesn't fit a group, ask whether it belongs in the interface.
3. `pnpm -r typecheck`.

If you remove one, note it in the "Withheld" comment at the bottom of the
header when the omission is a decision someone might otherwise read as an
oversight.
