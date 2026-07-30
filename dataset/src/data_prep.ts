// PARKED — the marker-driven crop derivation is gone, not ported. See #18.
//
// This script used to walk every point marker in every archive and cut one
// 136x136 crop per marker, tagged by the marker's type. v4 stores no point
// markers: a label is a car span, and a sensor is a query point on the layout.
//
// Deriving crops from car spans alone does not produce a trainable dataset.
// Every crop centre lies on a car, so every crop earns the same tag — the
// vocabulary does not shrink from three tags to two, it collapses to one,
// degenerate, with no negatives at all. This is why `classifier.labels` was
// deleted from config.yaml rather than corrected. See SPEC.md § v4 cannot
// produce a trainable CNN dataset (issue #8).
//
// The route back is documented and is an experiment, not a schema question:
// sample background crops as *verified* negatives, which `labeled_complete`
// makes sound — it asserts no car in the image is unlabeled, so a crop centre
// intersecting no span is a verified negative rather than a presumed one. That
// changes the negative distribution, and therefore invalidates any gate built
// on the old one. It stays dormant while the ResNet does.
//
// Do not revive this by inventing a substitute vocabulary or synthesising
// negatives.

console.error(
  [
    'dataset prep is parked: v4 stores no point markers to derive CNN crops from.',
    '',
    'Every crop derivable from a car span earns the same tag, so the crop',
    'vocabulary collapses to one degenerate class with no negatives. See',
    'SPEC.md § "v4 cannot produce a trainable CNN dataset" (issue #8) and the',
    'comment at the top of dataset/src/data_prep.ts.',
    '',
    'The route back is sampling background crops as verified negatives — an',
    'experiment to run, dormant while the ResNet is.',
  ].join('\n')
);

process.exit(1);
