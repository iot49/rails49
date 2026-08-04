"""How a source frame sits inside the model's input grid.

Its own module, importing nothing heavier than the standard library, for the
same reason `lib/detector/src/letterbox.ts` is kept apart from the ORT session:
this is the one piece of the export path that has to agree with code in another
language, and it should be testable without loading torch or a model.

**This duplicates the TypeScript.** Deliberately — see the resolution on issue
#100. The alternatives were emitting it from `config.yaml` (which is for
authored *values*, not functions) or having the quantizer shell out to node.
Both cost more than nine lines of arithmetic do. What keeps the two together is
`tests/test_letterbox.py` and `lib/detector/tests/decode.test.ts` asserting the
same scale and padding for the same input.
"""

from __future__ import annotations

from typing import NamedTuple

from PIL import Image

#: Ultralytics' own padding colour. The bars are in-distribution precisely
#: because training put this exact grey there; any other fill is a texture the
#: model has never seen.
FILL = (114, 114, 114)


class Letterbox(NamedTuple):
    """Isotropic scale, and half the leftover on each axis, in grid px."""

    scale: float
    pad_x: float
    pad_y: float


def letterbox(source: tuple[int, int], grid: tuple[int, int]) -> Letterbox:
    """Fit a `(width, height)` source into a `(width, height)` grid, aspect preserved."""
    source_width, source_height = source
    grid_width, grid_height = grid

    scale = min(grid_width / source_width, grid_height / source_height)

    return Letterbox(
        scale=scale,
        pad_x=(grid_width - source_width * scale) / 2,
        pad_y=(grid_height - source_height * scale) / 2,
    )


def letterboxed(image: Image.Image, grid: tuple[int, int]) -> Image.Image:
    """The image drawn into a grid-sized canvas of `FILL`, aspect preserved.

    Rounded to whole pixels here, where the browser's version stays in floats:
    the browser goes on to *undo* this map and needs the exact factors, while
    this one only has to hand the quantizer a frame shaped like the ones the
    deployed model will see.
    """
    fit = letterbox(image.size, grid)

    drawn = image.resize(
        (round(image.width * fit.scale), round(image.height * fit.scale)),
        Image.Resampling.BILINEAR,
    )
    canvas = Image.new("RGB", grid, FILL)
    canvas.paste(drawn, (round(fit.pad_x), round(fit.pad_y)))

    return canvas
