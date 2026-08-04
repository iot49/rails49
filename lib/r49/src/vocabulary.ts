import { DETECTOR_CLASSES, DETECTOR_VOCABULARY } from '@occupancy/config';

/**
 * How the authored class taxonomy is *read*. The taxonomy itself is authored in
 * `config.yaml` and reaches here through the generated `@occupancy/config`; this
 * module holds only the two rules for interpreting it.
 *
 * It lives in this package rather than in `ui/` because it now has two
 * consumers that must agree: the editor, where a non-conforming class is a
 * visible warning, and the corpus validator, where the same mismatch blocks a
 * submission. A rule implemented twice agrees only until someone edits one
 * copy — and these two matter *most* in the case where they disagree, because a
 * contributor would then be rejected for a class the editor drew as fine.
 *
 * This is not parse-time validation and must not become it: `class` is a plain
 * string at the format layer, deliberately (`SPEC.md` § Format). A format that
 * refused to open files because someone pruned `config.yaml` would punish
 * config edits.
 */

/**
 * One mapping in the taxonomy: subtypes by name, mixed with the node's own
 * properties.
 *
 * `unknown` rather than a union, because the two are told apart by shape and a
 * property may be any scalar the YAML allows.
 */
export type VocabularyNode = { readonly [key: string]: unknown };

/** The authored taxonomy. A separate name so the default is legible. */
const AUTHORED: VocabularyNode = DETECTOR_VOCABULARY;

/** The YOLO class list. A separate name so the default is legible. */
const CLASSES: readonly string[] = DETECTOR_CLASSES;

/**
 * Whether `prefix` matches `cls` **segment by segment** — either the whole
 * class or one of its dotted ancestors.
 *
 * The rule the whole module turns on: `stock` is a prefix of `stock.loco` and
 * of `stock`, but never of `stockyard`. A plain `startsWith` would match the
 * last of those, silently mapping an unrelated class onto a trained index.
 */
function isSegmentPrefix(prefix: string, cls: string): boolean {
  return cls === prefix || cls.startsWith(`${prefix}.`);
}

/**
 * The subtypes of a node, in authored order — the object-valued keys.
 *
 * **A nested object is a subtype; anything else is a property.** `width_mm` is
 * an optional per-class width override sitting beside subtypes in the same
 * mapping, and telling the two apart *structurally* is what avoids a reserved
 * list of key names that `config.yaml` would then have to know about.
 */
export function vocabularySubtypes(
  node: VocabularyNode
): readonly (readonly [string, VocabularyNode])[] {
  return Object.entries(node).filter(
    (entry): entry is [string, VocabularyNode] =>
      typeof entry[1] === 'object' && entry[1] !== null && !Array.isArray(entry[1])
  );
}

/**
 * The YOLO class index a stored class trains as: the position of the **longest**
 * entry of `detector.classes` that is a segment-prefix of it.
 *
 * Longest, not first, is what makes the class list append-only in a useful way.
 * Appending `stock.loco` re-maps every already-labeled locomotive onto the new
 * index with no relabeling, because `stock.loco` outranks the `stock` that used
 * to claim them — while a car labeled plain `stock` keeps matching `stock`.
 *
 * @param cls The stored `class` string, rooted and dot-separated.
 * @param classes Defaults to the authored class list; injectable for tests.
 * @returns The index, or `null` when no entry prefixes the class. `null` is a
 *          **fatal export error**, never a drop: an unexported car is an
 *          unlabeled car, which teaches the detector that cars are background.
 */
export function detectorClassIndex(cls: string, classes: readonly string[] = CLASSES): number | null {
  let index: number | null = null;
  let matched = -1;

  classes.forEach((entry, i) => {
    if (!isSegmentPrefix(entry, cls)) return;
    // Two entries that both prefix one class are nested, so the longer string
    // is unambiguously the more specific of the two.
    if (entry.length <= matched) return;
    index = i;
    matched = entry.length;
  });

  return index;
}

/**
 * Whether a stored class names an entry of the taxonomy.
 *
 * Matching is **segment by segment**, the same rule {@link detectorClassIndex}
 * maps with: `stockyard` is not `stock` with a suffix, and a property name is
 * not a class. The class is rooted — an unrooted `loco.steam` matches nothing.
 *
 * Distinct from {@link detectorClassIndex} in what it reads: the authoring
 * taxonomy, which the editor offers, against the class list, which is trained
 * on. A class can be known and still have no index — `stock.freight` is offered
 * by the menu and trains as `stock` — so neither answers for the other.
 *
 * @param cls The stored `class` string, rooted and dot-separated.
 * @param vocabulary Defaults to the authored taxonomy; injectable for tests.
 */
export function isKnownClass(cls: string, vocabulary: VocabularyNode = AUTHORED): boolean {
  if (cls === '') return false;

  let node: VocabularyNode = vocabulary;
  for (const segment of cls.split('.')) {
    const child = vocabularySubtypes(node).find(([name]) => name === segment)?.[1];
    if (!child) return false;
    node = child;
  }
  return true;
}
