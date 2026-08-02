#!/usr/bin/env python3
"""Generate every derived representation of config.yaml.

config.yaml is authored; everything else is generated and verified. This script
emits two of them:

  config.json          gitignored, consumed by the model export and the UI
  lib/config/src/      committed, so a fresh clone typechecks before anyone
                       runs a generator

Pass --out-dir to write somewhere other than the project root. bin/test.sh uses
that to regenerate into a temp directory and diff against the committed output,
so editing config.yaml without regenerating fails the full check rather than
surfacing at runtime.
"""

import argparse
import json
import os
import sys
from typing import NoReturn

import yaml

# Emitted verbatim at the top of every generated TypeScript file.
BANNER = """// GENERATED FILE — DO NOT EDIT.
//
// Source: config.yaml (the single authored home for these values).
// Regenerate with: pnpm config:generate
//
// Hand edits are lost on the next run, and bin/test.sh fails the build when
// this file disagrees with config.yaml.
"""


def fail(message: str) -> NoReturn:
    print(f"❌ {message}")
    sys.exit(1)


def require(config: dict, *path: str):
    """Fetch a nested key, failing loudly rather than emitting a hole."""
    node = config
    for i, key in enumerate(path):
        if not isinstance(node, dict) or key not in node:
            fail(f"config.yaml is missing '{'.'.join(path[: i + 1])}'")
        node = node[key]
    return node


def ts_literal(value) -> str:
    """Render a JSON-compatible Python value as a TypeScript literal.

    Key order is preserved exactly as authored — load order for dicts, list
    order for arrays. detector.classes depends on this: a list position is a
    YOLO class index.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(ts_literal(v) for v in value) + "]"
    if isinstance(value, dict):
        if not value:
            return "{}"
        body = ", ".join(f"{json.dumps(k)}: {ts_literal(v)}" for k, v in value.items())
        return "{ " + body + " }"
    fail(f"cannot render {type(value).__name__} as a TypeScript literal")


def doc(*lines: str) -> str:
    if len(lines) == 1:
        return f"/** {lines[0]} */"
    body = "\n".join(f" * {line}".rstrip() for line in lines)
    return f"/**\n{body}\n */"


def render_generated_ts(config: dict) -> str:
    standard_gauge = require(config, "layout", "standard_gauge")
    standard_width = require(config, "layout", "standard_width")
    scale_to_ratio = require(config, "layout", "scale_to_ratio")
    min_dpt = require(config, "layout", "min_dpt")

    detector_input = require(config, "detector", "input")
    confidence_threshold = require(config, "detector", "confidence_threshold")
    detector_classes = require(config, "detector", "classes")
    vocabulary = require(config, "detector", "vocabulary")

    if not scale_to_ratio:
        fail("config.yaml has an empty 'layout.scale_to_ratio'")
    if not detector_classes:
        fail("config.yaml has an empty 'detector.classes'")
    # The editor takes the class of every new car from this taxonomy's single
    # root rather than hardcoding one. None leaves it with no class to write at
    # all; a second makes "the root" — the thing every class must be rooted at —
    # ambiguous. Failing here is what keeps both a config error with a message
    # rather than a runtime one in the browser: `ui/src/vocabulary.ts` enforces
    # the same rule and can only throw.
    roots = [name for name, node in vocabulary.items() if isinstance(node, dict)]
    if len(roots) != 1:
        fail(
            "config.yaml's 'detector.vocabulary' must name exactly one root class, "
            f"found {len(roots)}"
        )

    scale_names = list(scale_to_ratio.keys())
    scale_union = " | ".join(json.dumps(name) for name in scale_names)

    # Doc prose that quotes a value must compute it from the config, so it can
    # never disagree with the constant it sits on.
    width_in_gauges = f"{standard_width / standard_gauge:.2f}"
    example_scale = "HO" if "HO" in scale_to_ratio else scale_names[0]
    example_ratio = f"{scale_to_ratio[example_scale]:g}"

    parts = [
        BANNER,
        "//── Layout geometry ─────────────────────────────────────────────────────────",
        "",
        doc("Prototype track gauge in mm. One authored home, in config.yaml."),
        f"export const STANDARD_GAUGE = {ts_literal(standard_gauge)};",
        "",
        doc(
            "Prototype car width in mm — the widest real stock, not a typical one.",
            "",
            "Car width is derived from this rather than stored per label. Because",
            "width in pixels is `DPT * STANDARD_WIDTH / STANDARD_GAUGE`, the scale",
            f"ratio cancels: a car is the same {width_in_gauges} track-widths wide in every scale.",
        ),
        f"export const STANDARD_WIDTH = {ts_literal(standard_width)};",
        "",
        doc(
            "Minimum usable DPT. Warns persistently, never blocks — the fixture",
            "corpus sits below it at DPT 18-19.",
        ),
        f"export const MIN_DPT = {ts_literal(min_dpt)};",
        "",
        doc("Every scale name config.yaml defines a ratio for."),
        f"export type Scale = {scale_union};",
        "",
        doc(
            f"Scale name to reduction ratio ({example_scale} is 1:{example_ratio}). Model-domain gauge is",
            "`STANDARD_GAUGE / SCALE_TO_RATIO[scale]`.",
        ),
        f"export const SCALE_TO_RATIO = {ts_literal(scale_to_ratio)} as const;",
        "",
        doc(
            "Scale names as a non-empty tuple, in config.yaml's order — the form a",
            "schema enum needs.",
        ),
        "export const SCALES: readonly [Scale, ...Scale[]] = ["
        + ", ".join(json.dumps(name) for name in scale_names)
        + "];",
        "",
        "//── Detector ────────────────────────────────────────────────────────────────",
        "",
        doc("Detector input resolution, `[width, height]` in pixels."),
        f"export const DETECTOR_INPUT = {ts_literal(detector_input)} as const;",
        "",
        doc(
            "Single confidence threshold for decoding detections.",
            "",
            "A placeholder until held-out recall can set it. Nothing reads it yet;",
            "how the eventual detector export applies it is that export's to decide.",
        ),
        f"export const DETECTOR_CONFIDENCE_THRESHOLD = {ts_literal(confidence_threshold)};",
        "",
        doc(
            "The YOLO class list, verbatim and index-ordered.",
            "",
            "⚠️  APPEND-ONLY. A position in this array *is* a class index, so",
            "reordering or removing an entry invalidates trained weights while",
            "config.yaml still validates. Edit config.yaml, never this file.",
            "",
            "A label maps to the longest entry that is a segment-prefix of its class:",
            "`stock` matches `stock.loco.steam` but never `stockyard`.",
        ),
        f"export const DETECTOR_CLASSES = {ts_literal(detector_classes)} as const;",
        "",
        doc(
            "The authoring taxonomy — what a label's `class` should match.",
            "",
            "The root is required, not cosmetic: an unrooted class matches no",
            "entry in DETECTOR_CLASSES and would be dropped from an export. The root",
            "itself is not offered in the UI; its children are.",
            "",
            "A **nested object is a subtype**; any other value is a property of the",
            "class it sits under (`width_mm` is the one such property today). That",
            "is what tells a subtype from a property with no reserved key names.",
        ),
        f"export const DETECTOR_VOCABULARY = {ts_literal(vocabulary)} as const;",
        "",
    ]
    return "\n".join(parts)


def render_index_ts() -> str:
    return "\n".join(
        [
            BANNER,
            "// Public interface of @occupancy/config.",
            "//",
            "// This file is the package's interface — the only surface consumers may",
            "// rely on. Per-symbol documentation lives on the declarations in",
            "// ./generated.ts, because TypeScript discards doc comments written on",
            "// re-export statements.",
            "",
            "//── Layout geometry ─────────────────────────────────────────────────────────",
            "// The constants that must agree across every stage of the pipeline.",
            "export {",
            "  STANDARD_GAUGE,",
            "  STANDARD_WIDTH,",
            "  MIN_DPT,",
            "  SCALE_TO_RATIO,",
            "  SCALES,",
            "  type Scale,",
            "} from './generated.ts';",
            "",
            "//── Detector ────────────────────────────────────────────────────────────────",
            "// Values only. Nothing here is wired into a runtime yet.",
            "export {",
            "  DETECTOR_INPUT,",
            "  DETECTOR_CONFIDENCE_THRESHOLD,",
            "  DETECTOR_CLASSES,",
            "  DETECTOR_VOCABULARY,",
            "} from './generated.ts';",
            "",
            "// Withheld: everything under `classifier` and `cnn` in config.yaml. The",
            "// classifier reads its own config.json at runtime and the CNN training",
            "// hyperparameters are Python's; neither needs a TypeScript binding, and",
            "// exporting them would invite a second consumer for values that have one.",
            "",
            "// Withheld: `global.rails_domain`. ui/vite.config.ts injects it at build",
            "// time as __RAILS_DOMAIN__, reading config.yaml directly — importing it",
            "// here would give that one value two paths into the bundle.",
            "",
        ]
    )


def write(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(content)


def main() -> None:
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        default=project_root,
        help="Root to write generated files under (default: the project root).",
    )
    args = parser.parse_args()

    yaml_path = os.path.join(project_root, "config.yaml")
    if not os.path.exists(yaml_path):
        fail(f"config.yaml not found at {yaml_path}")

    try:
        with open(yaml_path, "r") as f:
            config = yaml.safe_load(f)
    except Exception as e:
        fail(f"could not parse config.yaml: {e}")

    if not isinstance(config, dict):
        fail("config.yaml did not parse to a mapping")

    if "labels" in config.get("classifier", {}):
        fail(
            "config.yaml still carries 'classifier.labels'. It was deleted rather "
            "than corrected — nothing could verify it, and v4 cannot produce the "
            "vocabulary it named. See SPEC.md § Parameters live in config.yaml."
        )

    out_dir = os.path.abspath(args.out_dir)
    json_path = os.path.join(out_dir, "config.json")
    pkg_src = os.path.join(out_dir, "lib", "config", "src")

    try:
        write(json_path, json.dumps(config, indent=2))
        write(os.path.join(pkg_src, "generated.ts"), render_generated_ts(config))
        write(os.path.join(pkg_src, "index.ts"), render_index_ts())
    except OSError as e:
        fail(f"could not write generated output: {e}")

    print(f"✅ Generated {json_path}")
    print(f"✅ Generated {pkg_src}/generated.ts and index.ts")


if __name__ == "__main__":
    main()
