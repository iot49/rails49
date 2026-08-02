import { DETECTOR_VOCABULARY } from '@occupancy/config';

/**
 * The authored class taxonomy, read as a tree — the one place `ui/` learns what
 * a car may be called.
 *
 * A pure module for the same reason `geometry.ts` is one: it is arithmetic over
 * data, and a component cannot be tested in jsdom. Everything here is derived
 * from `detector.vocabulary` in `config.yaml`, reached through the generated
 * `@occupancy/config`, so **adding a subtype there and regenerating changes the
 * editor's menu with no code edit** — and no class name is written anywhere
 * else in `ui/` (`SPEC.md` § Parameters live in `config.yaml`).
 *
 * Two rules the tree is read with, both of which are wrong somewhere if
 * reimplemented:
 *
 * * **A nested object is a subtype; anything else is a property.** `width_mm`
 *   is an optional per-class width override that sits beside subtypes in the
 *   same mapping, and telling the two apart structurally is what avoids a
 *   reserved list of key names that config.yaml would then have to know about.
 * * **The stored class is always rooted, and the root is never shown.** A label
 *   maps to the longest entry of `detector.classes` that is a segment-prefix of
 *   its class, so an unrooted `loco.steam` matches nothing and is **dropped
 *   from the export** — the unlabeled-car-as-background failure the
 *   completeness rule exists to prevent. So `class` carries `stock.` and the
 *   menu renders the root's children.
 */

/**
 * One mapping in the taxonomy: subtypes by name, mixed with the node's own
 * properties.
 *
 * `unknown` rather than a union, because the two are told apart by shape and a
 * property may be any scalar the YAML allows.
 */
export type VocabularyNode = { readonly [key: string]: unknown };

/** One class the menu can offer, and the subtypes nested under it. */
export interface ClassChoice {
  /** The full dotted class, root included — exactly what is stored. */
  readonly class: string;
  /** The last segment, which is what the user reads. */
  readonly name: string;
  /** Subtypes of this class, in authored order. Empty for a leaf. */
  readonly children: readonly ClassChoice[];
}

/** The authored taxonomy. A separate name so the default is legible. */
const AUTHORED: VocabularyNode = DETECTOR_VOCABULARY;

/** The subtypes of a node, in authored order — the object-valued keys. */
function subtypes(node: VocabularyNode): readonly (readonly [string, VocabularyNode])[] {
  return Object.entries(node).filter(
    (entry): entry is [string, VocabularyNode] =>
      typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1])
  );
}

/**
 * The taxonomy's single root — the class every new car is created as.
 *
 * Derived rather than written down: the editor authoring a hardcoded `'stock'`
 * would be a second home for a value `config.yaml` owns, and it would go on
 * agreeing with the vocabulary only by luck.
 *
 * **Exactly one root**, and both other counts throw rather than guess. None
 * leaves a new car with no class to be created as, and a second makes "the
 * root" — the thing every class must be rooted at — ambiguous. `bin/generate_config.py`
 * rejects an empty vocabulary, so reaching either case means a hand-edited
 * `lib/config`, which is already a documented mistake.
 *
 * @throws If the vocabulary does not name exactly one root class.
 */
export function rootClass(vocabulary: VocabularyNode = AUTHORED): string {
  const roots = subtypes(vocabulary);
  if (roots.length !== 1) {
    throw new Error(
      `detector.vocabulary must name exactly one root class, found ${roots.length}. ` +
        'Edit config.yaml and run: pnpm config:generate'
    );
  }
  return roots[0][0];
}

/** The subtree under one node, as choices carrying their full dotted class. */
function choicesUnder(node: VocabularyNode, prefix: string): readonly ClassChoice[] {
  return subtypes(node).map(([name, child]) => {
    const dotted = `${prefix}.${name}`;
    return { class: dotted, name, children: choicesUnder(child, dotted) };
  });
}

/**
 * What the reclassify menu offers: the root's children, nested.
 *
 * The root itself is **not** among them — it is required in the stored class
 * and absent from the UI — so a taxonomy that is only a root offers nothing,
 * and the editor opens no reclassify row at all rather than an empty submenu.
 */
export function classChoices(vocabulary: VocabularyNode = AUTHORED): readonly ClassChoice[] {
  const root = rootClass(vocabulary);
  return choicesUnder(vocabulary[root] as VocabularyNode, root);
}

/**
 * Whether a stored class names an entry of the taxonomy.
 *
 * `class` is a plain string at the format layer and is deliberately **not**
 * validated when an archive is parsed (`SPEC.md` § Format): a format that
 * refused to open files because someone pruned `config.yaml` would punish
 * config edits. So conformance is a visible warning here in the editor, and a
 * fatal error in the training exporter later, where a mis-mapped class is what
 * silently corrupts a model.
 *
 * Matching is **segment by segment**, the same rule the exporter maps with:
 * `stockyard` is not `stock` with a suffix, and a property name is not a class.
 */
export function isKnownClass(cls: string, vocabulary: VocabularyNode = AUTHORED): boolean {
  if (cls === '') return false;

  let node: VocabularyNode = vocabulary;
  for (const segment of cls.split('.')) {
    const child = subtypes(node).find(([name]) => name === segment)?.[1];
    if (!child) return false;
    node = child;
  }
  return true;
}
