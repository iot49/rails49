#!/usr/bin/env python3

import argparse
from pathlib import Path

from classifier.learn.exporter import Exporter


def main():
    parser = argparse.ArgumentParser(description="Export and Release Model")
    parser.add_argument(
        "model",
        type=str,
        nargs="?",
        default="resnet18",
        help="Name of the model to train (e.g. resnet18)",
    )

    args = parser.parse_args()

    print(f"Exporting model {args.model}...")

    try:
        # Export directly to frontend/public/models so they are available at /models/{name}
        output_dir = Path("frontend/public/models") / args.model
        print(f"Target directory: {output_dir}")

        exporter = Exporter(args.model)
        exporter.export(output_dir=output_dir)
    except Exception as e:
        print(f"Export failed: {e}")


if __name__ == "__main__":
    main()
