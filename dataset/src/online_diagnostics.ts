// PARKED — the marker-driven confusion matrix is gone, not ported. See #18.
//
// This script used to re-classify every point marker in every archive with the
// exported ResNet and print a confusion matrix of marker type against
// prediction. v4 stores no point markers, so there is nothing to iterate and
// no per-marker ground-truth tag to compare a prediction against.
//
// It is parked rather than rewritten for the same reason dataset prep is: the
// tags it scored no longer exist in the format. See the comment at the top of
// data_prep.ts, and SPEC.md § v4 cannot produce a trainable CNN dataset
// (issue #8).
//
// Note also that this measured nothing generalizable — it scored the same
// archives the model trained on. Whatever replaces it belongs to the held-out
// protocol SPEC.md § Accuracy leaves open, not to a port of this file.

console.error(
  [
    'dataset online-diagnostics is parked: v4 stores no point markers to score.',
    '',
    'The confusion matrix compared each marker\'s type tag against a prediction;',
    'v4 has neither. See SPEC.md § "v4 cannot produce a trainable CNN dataset"',
    '(issue #8) and the comment at the top of',
    'dataset/src/online_diagnostics.ts.',
    '',
    'A replacement belongs to the held-out accuracy protocol that does not yet',
    'exist (SPEC.md § Accuracy), not to a port of this script.',
  ].join('\n')
);

process.exit(1);
