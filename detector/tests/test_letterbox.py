"""The half of the cross-language check that lives in Python.

`detector/letterbox.py` and `lib/detector/src/letterbox.ts` are the same nine
lines of arithmetic written twice, one preprocessing the quantizer's calibration
frames and one preprocessing the browser's video frames. If they drift, nothing
errors: the model quantizes, loads, runs, and is simply calibrated for a
geometry it is never given.

So the cases below are chosen to be the ones where a stretch and a letterbox
*differ*, and the numbers are the ones `lib/detector/tests/decode.test.ts`
asserts on the other side. Changing one without the other should turn something
here red.
"""

from __future__ import annotations

from PIL import Image

from letterbox import FILL, letterbox, letterboxed

#: `detector.input`. Hard-coded rather than read from config.yaml: this is a
#: pinning test, and a pin that moves with the thing it pins is not a pin.
GRID = (960, 544)


def test_the_corpus_today_pads_two_pixels_per_edge() -> None:
    """1920x1080 is the aspect a stretch and a letterbox nearly agree on."""
    fit = letterbox((1920, 1080), GRID)

    assert fit.scale == 0.5
    assert fit.pad_x == 0
    assert fit.pad_y == 2


def test_the_intended_capture_geometry_pads_forty_two_pixels_per_edge() -> None:
    """One camera over the 2000x960 mm layout at >=20 DPT in N scale: ~4440x2130.

    The same source `lib/detector/tests/decode.test.ts` uses in "undoes the
    letterbox bars a 2.08:1 source is padded with", and the reason the plain
    resize this replaced could not stay: 2.08:1 stretched into a 16:9 grid
    delivers every car about 15% short along its length.
    """
    fit = letterbox((4440, 2130), GRID)

    assert fit.scale == 960 / 4440
    assert fit.pad_x == 0
    assert 40 < fit.pad_y < 43


def test_a_tall_source_pads_horizontally() -> None:
    """The other axis, which no real camera produces and no other test covers."""
    fit = letterbox((544, 960), GRID)

    assert fit.scale == 544 / 960
    assert fit.pad_y == 0
    assert fit.pad_x > 0


def test_the_drawn_image_lands_inside_the_bars() -> None:
    """Grid-sized canvas, Ultralytics grey in the bars, content between them."""
    source = Image.new("RGB", (4440, 2130), (255, 0, 0))
    canvas = letterboxed(source, GRID)

    assert canvas.size == GRID
    assert canvas.getpixel((480, 2)) == FILL
    assert canvas.getpixel((480, 541)) == FILL
    assert canvas.getpixel((480, 272)) == (255, 0, 0)
