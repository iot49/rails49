# Model Railroad Track Occupancy Detection with Cameras

## Goals

* Detect presence of trains at specific locations in a layout (**block detection**)
* Detect location, size (length), and orientation of all trains in a layout (**track occupancy detection**)

## Assumption

Humans can reliably control model railroad trains (and real prototype trains) using primarily visual information. **AI should be able to do the same.**

## Classifier

A classifier is used to establish track occupancy. Solutions include:

1. **Image change.** Images taken subsequently differ as trains move. Requires no training and very little compute. The [EX-SensorCAM](https://dcc-ex.com/mkdocs-test/products/ex-sensorcam/ex-sensorcam/) project uses an ESP32 and an inexpensive camera for this. **Investigated and rejected as a primary strategy** — see below.
2. **CNN.** A ResNet or MobileNet recognizing the presence or absence of a train at a specific location. Block detection only. This is what ships today.
3. **Object detector.** A detector such as YOLO that finds the location and orientation of every railroad car on the layout. This gives the most complete information.

Options 2 and 3 are complementary rather than exclusive: the detector answers "where is every car", the CNN answers "is this specific point occupied". Both are fed from the same labels (see [Location Data](#location-data-track-cars-sensors)).

### Image change is not a candidate for occupancy

**Decision: change detection will not be used as a primary occupancy classifier.** Options 2 and 3 are the strategy. This is settled, not open — see the full analysis in [`docs/research/image-change-detection.md`](../docs/research/image-change-detection.md).

The reason is structural rather than a matter of tuning. A change detector must adapt its reference frame to survive illumination drift, and must *not* adapt while a train sits still. The only policy that satisfies both is to gate adaptation on the occupancy decision itself — which is what EX-SensorCAM does — and that makes **both error directions absorbing states**: a false trip freezes the reference and therefore persists, while a missed train is averaged into the reference and becomes permanent background. DCC-EX documents this in its own manual: the sensor can remain permanently "occupied" until manually re-referenced. No threshold trades the two off; it only selects which latch you get.

Supporting findings:

* SensorCAM's metric is per-quadrant colour *ratios*, not pixel differencing — deliberately intensity-invariant, with a decision budget of ~10 counts. Re-implemented and run against this repo's own `lighting.r49`, it false-tripped on **100%** of samples of a patch of bare table that is visually identical across the sequence, and 25.5% between the mildest adjacent image pair. `lighting.r49`'s luminance moves only 7%, but its R/B ratio moves 10.5% — precisely the axis the metric measures.
* No measured accuracy figure is published anywhere by the project; it is self-described Alpha and its own comparison page says it is "not currently suitable for exhibition layouts". SPEC's earlier "gives little information about accuracy" was, if anything, understated.
* In the literature this is CDnet 2014's *Intermittent Object Motion* category, where unsupervised methods score 0.66–0.78 F-measure against ~0.95 on baseline sequences — and every method that closes the gap does so by adding a semantic segmenter or instance detector, i.e. the field's own answer is Option 3.
* Change detection has no notion of "train". `lighting.r49`'s variation was in fact produced by placing a cardboard box in the scene; a change detector reports that as occupancy, as it would a hand, a tool, or a person leaning over the layout.

What the rejection does **not** claim: change detection is cheap, needs no labels, and — at the DPT 3.4–7.6 SensorCAM operates at — is the one option not blocked on the DPT > 20 threshold. Those properties make it genuinely useful for jobs that are not occupancy; see [Secondary uses of change detection](#secondary-uses-of-change-detection).


## Accuracy

Extremely high accuracy is required to avoid collisions and other problems.

Classifiers can be trained per layout, so only modest generalization is needed — recognizing trains at layout positions absent from the training data, or rolling stock the model has not seen. On that basis >99.9% should be achievable. (Still not sufficient for prototype trains, where accidents are far more costly.)

> ⚠️ **The currently reported 99.58% is not a generalization estimate.** The regression test iterates every marker in every archive, so roughly 770 of its 963 samples were seen during training. It is a *reproducibility* check — does this `.ort` still behave like the published one — not a held-out measurement. Any >99.9% target needs a held-out evaluation that does not yet exist. See issue #4. *More testing and formal assessment is required with newly trained classifiers or detectors.*

**Safety:** nothing here may be presented as a safety interlock. The classifier does sometimes miss rolling stock and report phantom trains.

## Features

The UI provides an interface to create, visualize, and edit `.r49` files via the library in `../lib/r49`. The sections below describe the requirements.

### Images

`.r49` files contain a list of images of the model layout taken with an overhead camera. The UI allows acquiring and removing images.

### Calibration

#### Establishes the relation (scale) to the prototype

Supports common track geometries (HO, N, Z, etc).

#### Establishes the relation between image pixels and physical dimensions

To avoid having to recognize objects at different scales, the app uses **DPT** (dots per track width) as the relation between pixel and physical coordinates.

**Example.** Two points in an N-scale layout are 1000 pixels apart in the image and 250 mm apart on the physical layout, giving 1000/250 = **4 dots per millimeter**. Track width in N scale is `STANDARD_GAUGE/160 = 1435/160 ≈ 9 mm` (`STANDARD_GAUGE` is defined in the `.r49` library). Hence **DPT = 4 × 9 = 36** dots per track width for this image.

In practice **DPT > 20** is required: below that, a car is too few pixels across for the detector to localize reliably, and the CNN's crop covers too little of the track to be discriminative. The corpus measured so far sits at DPT 18–19, i.e. marginally under this threshold. The threshold is a named constant in `config.yaml`, alongside `crop_size`, rather than a number buried in the UI.

> **Consequence — UI development and training data are decoupled.** The existing 46 images are below the DPT threshold and need re-shooting, which is not currently possible. They remain perfectly adequate as **UI fixtures**: they exercise every code path in the editor and cost nothing. **Training will use fresh, higher-DPT images captured later.** Do not tune model accuracy against the current corpus, and do not treat its numbers as predictive.

Ideally the layout is perfectly parallel to the camera plane. Then it suffices to specify the distance in millimeters between two points at the same height to establish DPT. Otherwise the image suffers perspective distortion, and several points in 3D space are required to compute the correcting transform.

In practice the errors from camera misalignment have been negligible and **two-point calibration is sufficient**, so that is what the UI uses. However the `.r49` format accepts a list of **3D coordinate points** (relative to an arbitrary but fixed origin) so full calibration remains possible later without another format change.

Other errors, such as camera barrel distortion, are ignored.

#### Reference points

Calibration is a **list of points, each carrying both coordinates** — where it is in the image, and where it is on the layout:

```jsonc
calibration: {
  points: [
    { px: { x, y }, world: { x, y, z } },   // px = image pixels, world = mm
    ...
  ]
}
```

`world` is relative to an **arbitrary origin that is the same for every point in the layout**; the orientation of that frame is arbitrary too. A flat layout is implicit and accepted — in practice every point shares one `z`.

A point carries no `id` and no `name`. Nothing references an individual point, so identity buys nothing at the two-to-four points a real calibration has; both are additive later if perspective correction ever wants them. The v3 `size_mm` field is gone — the distance it encoded is implied by the world coordinates.

**DPT is a single least-squares scale over equal-height pairs:**

```
pairs = { (i,j) : z_i == z_j }
s     = Σ(d_px · d_mm) / Σ(d_mm²)   over pairs
DPT   = s · gauge_mm(scale)
```

Only pairs at equal `z` enter the fit. Under a pinhole camera, two points at different heights sit at different depths, so their pixel separation mixes scale with depth; including such a pair biases DPT silently, and worse the taller the feature. This is the "two points at the same height" rule above, generalised to N points.

At N = 2 the single pair reduces the fit to `d_px / d_mm`, which is exactly what `getDPT()` computes today — so importing a v3 archive changes no existing DPT. The `d_mm²` weighting favours long baselines automatically, which is the right bias: click error is a fixed number of pixels, so short baselines are proportionally noisier. When no equal-`z` pair exists, DPT is `null` — uncalibrated. Points out of the reference plane are stored but **inert**: they provision perspective correction without implementing it.

A v3 `{p0, p1, size_mm}` imports as two points at `world (0,0,0)` and `(0, size_mm, 0)`. Nothing is lost; a measured distance *is* a pair of positions in a frame you chose.

**Minimum viable calibration is two points with a nonzero separation** — precisely "DPT resolves". Because car width is derived from DPT rather than stored, an uncalibrated archive cannot render a label at all, so the editor opens in calibration mode with the labeling tools **disabled and the reason stated**. The translucent width rectangle is the only feedback that tells a user whether their two clicks actually cover the car; labeling without it produces a corpus nobody can trust. A `DPT` below the threshold warns persistently but **never blocks** — the fixture corpus lives there.

Points are placed with a tool **distinct from the sensor tool** and visually unmistakable from it: click a pixel, then enter the x/y/z millimetre coordinate. A point renders as a crosshair labelled with its world coordinate. With more than two points the editor shows the **fit residual**, so a mis-typed coordinate is visible rather than silently absorbed into the scale.

#### Image Alignment

For pixel data to map to the same layout location, the camera position must not change across images or during classification. **For now we assume this holds.** Workarounds — aligning images on structural details such as track and landscape features, fiducial markers, or simply *detecting* drift and refusing to classify — are tracked in [issue #12](https://github.com/iot49/rails49/issues/12). Note the current failure mode is silent: nothing records the camera pose and nothing notices when it changes. Frame-to-frame change detection is a plausible implementation of the drift check; see [Secondary uses of change detection](#secondary-uses-of-change-detection).

> Measured: within an archive the camera *is* static. `lighting.r49` has a track marker at (202, 591) in image-0 and (202, 592) in image-1. Calibration is also **shared verbatim across archives** — the three `cars *` archives carry byte-identical calibration — which may be a data-entry error rather than a genuinely identical rig. [Issue #6](https://github.com/iot49/rails49/issues/6) closed this as **not worth provisioning against**: those archives are disposable UI fixtures, so v4 records no calibration provenance (no authoring-image reference, no per-point names, no content fingerprints). The general case — a stale calibration failing silently — is camera drift, and belongs to [issue #12](https://github.com/iot49/rails49/issues/12).

### Location Data: Track, Cars, Sensors

The `.r49` format and UI editor store and edit three distinct kinds of geometry in pixel coordinates. They differ in scope and in whether the model ever sees them:

| | Geometry | Scope | Trained on? |
|---|---|---|---|
| **Track** | Splines / Bezier curves | Per **layout** — identical for all images | **No** — authored reference geometry |
| **Cars** | Two points over the track centerline | Per **image** | **Yes** — the detector's only class |
| **Sensors** | Single point | Per **layout** | **No** — an output specification |

1. **Track.** The centerline of every track, drawn once per layout. Track does not move, so it is not re-drawn per image, and it is never a detector class — it is authored geometry used to place cars, define what a sensor sits on, and generate empty-track training crops for the CNN.

2. **Cars.** Cars are straight and of standard width (2.8 m prototype), so a car is fully described by **two points** over the center of a track segment; width is derived from the scale rather than stored. Trains are sequences of cars where the end of one coincides with the start of the next — so **couplings need not be labeled or detected**, they are derivable from abutting car endpoints.

3. **Sensors** (block detectors). Points where occupancy must be reported when running trains. These are an *output specification*, not training data: they say where the deployed system must answer, and they never enter a loss function.

#### Labeling completeness

Every image used for detector training must have **all** of its cars labeled. An object present but unlabeled is treated as background by the loss, so partial labeling actively teaches the detector that cars are background. This cannot be scoped per class — the loss is shared across a whole image.

Each image therefore carries a **completeness flag**; only complete images are exported for training. Incomplete images remain useful for authoring and review. This matters concretely: `cars 0-10.r49` currently has 32 track markers on image-0 and **zero** on its other ten images.

An image marked complete with **zero** car labels is legitimate, not a gap — it is an all-background sample, which is exactly what the car-free first image of an archive is (see below).

### Labeling Workflow

The editor guides a specific order, because the order is what keeps a training set honest:

1. **Calibrate** — two points minimum.
2. **Label all track** — authored once per layout, on a car-free image.
3. **Label all cars** — per image.

Sensors can be placed at any time.

**Stages are gated on existence, never on completion.** Calibration gates track authoring, because car and track width are derived from DPT and the width rectangle is the only feedback that a label actually covers what it claims. Track does *not* hard-gate cars: since a car can only be created **on** track, the car tool is simply inert until a spline exists. Every stage stays re-enterable, and nothing can verify that *all* track has been labeled, so nothing pretends to — the flow is encouraged by ordering, not enforced by blocking.

**The first image of an archive must be car-free.** Track is authored on it. This is stated to the user rather than verified — nothing can detect cars before a detector exists. Beyond making track authoring unambiguous, a car-free image is the cleanest source of empty-track CNN crops, and it is a valid complete image with zero cars.

Track is layout-scoped, so it renders on **every** image, drawn occluded where a car covers it — the assumption that track continues underneath a car is shown rather than implied.

#### Authoring cars, and the trains they form

Cars **snap to the nearest track**; a car remains a straight chord between two points on the spline.

A train is authored as a **chain of clicks**: the first click starts a car, and every click after it is simultaneously the end of the current car and the start of the next. **Right-click ends the chain**, and the next click starts a new train. Nothing about the train is stored — it stays derived from coincident endpoints. Chaining simply guarantees that the coincidence is exact.

Because a coupling is where two endpoints coincide, it renders as **one shared handle**: dragging it moves both cars' endpoints together, so a train survives editing. Deleting a single car remains possible as an error-correction path — deleting the middle car of three leaves two derived trains, with no residue.

Dragging edits everything: car endpoints, coupler joints, calibration points, sensors, and spline control points.

#### Right-click is state-dependent

| State | Right-click |
| :-- | :-- |
| Chaining a train | Ends the chain |
| Idle | Context menu on the object under the cursor |

The context menu carries **delete** and **reclassify**, and it is the reason the editor needs no delete mode at all. It is also where a dotted class taxonomy belongs: `stock › loco › steam` nests as a submenu rather than requiring a persistent picker. A newly created car is `stock`; refinement happens through the menu.

One gesture meaning two things depending on state is a real cost, accepted here because the two states differ by whether a chain is in progress — which is already loudly visible as a rubber band.

#### No copy-forward

Labels are not carried between images. Track needs it least — it is authored once per layout — and copying *cars* across a set where nothing moves was considered and rejected: hand-labeling every image is what keeps provenance and the completeness flag unambiguous.

### Assisted Labeling

Hand-labeling every car in every image is the dominant cost of building a training set. Once a classifier exists, the UI should **propose** labels — track and cars — which the user then edits, corrects, or rejects. The human remains the author; the model supplies a first draft.

**This may require a second, separate model.** The production detector's only class is rolling stock (see [Location Data](#location-data-track-cars-sensors)); a proposal model would additionally detect **track**, so it can suggest the spline layout. That model is an **authoring aid only** and is never used for live classification. The two differ in class set, in accuracy requirements, and in consequence of error: a wrong proposal costs the user a correction, a wrong live classification could cost a collision.

Track staying authored geometry in the `.r49` format is unaffected by this. A proposal model suggests splines; the file still stores what the human approved.

#### Provenance is required, not optional

Accepted proposals that later become training data create a feedback loop: the model trains on its own output and amplifies its own errors, including systematic ones a user is unlikely to catch — a plausible proposal is easy to accept without scrutiny.

Each label therefore records **how it came to exist**:

| Provenance | Meaning |
|---|---|
| `human` | Drawn by hand |
| `proposed` | Model-proposed, accepted without modification |
| `corrected` | Model-proposed, then edited by the user |

This costs one field and makes the difference measurable: proposal acceptance rate is a direct quality signal, and unedited proposals can be excluded or down-weighted when building a training set. Retrofitting provenance after a corpus has been labeled is not possible.

#### Bootstrapping

A track-proposing model needs track labels to train on, which is what it is meant to help produce. The first layout must be labeled by hand. The v3 corpus's 244 existing track point markers may be enough to seed a weak first version — worth testing, not worth assuming.

### Testing and Demo

Beyond scaling and labeling layouts, the UI also interacts with the classifier:

1. Run the classifier on a still image or video stream from the camera. Testing and demo only; throughput is not critical.
2. Highlight classification errors and high-loss samples (training or test set) for diagnosis.
3. Real-time classification, e.g. on a mobile device, uploading results via MQTT to a model railroad controller such as [Rocrail](https://www.rocrail.online/). Current hardware capability and browser restrictions (camera access and resolution) limit the feasibility of this option today.

### Secondary uses of change detection

Rejecting change detection as an occupancy classifier does not reject the technique. Its liabilities are all consequences of having to answer "is a train here?" — a question it cannot latch onto correctly. For jobs where the wrong answer costs a warning or a wasted frame rather than a collision, it is cheap and appropriate. Three such uses, in descending order of value:

1. **Camera-drift detection.** Compare the structural content of the current frame against the frame the calibration was authored on, and *refuse to classify* when they disagree. This is occupancy-agnostic, so it has no latch problem, and it converts [Image Alignment](#image-alignment)'s currently silent failure into a loud one. This is the strongest use and belongs in [issue #12](https://github.com/iot49/rails49/issues/12); a change-based drift check is a candidate implementation of the "detecting drift and refusing to classify" workaround already named there.

2. **Re-classification gating.** In live view, skip inference on frames where nothing changed. Purely a compute optimisation — a false negative costs a stale frame, never a wrong occupancy report. Relevant to [Testing and Demo](#testing-and-demo) item 3, where mobile hardware is the constraint.

3. **Change proposes, CNN disposes.** Use change detection to nominate candidate regions and the CNN to decide each one. This is sound, and is the architecture the background-subtraction literature converged on — but it is **Option 2 or 3 with a cheap front end, not Option 1**: it still requires the CNN, and it does not lift the DPT > 20 requirement, because the CNN is still what decides.

Items 1 and 2 are not scheduled work. They should be raised as feature requests when the surrounding work is picked up — item 1 folded into issue #12, item 2 as its own request against the live view. Item 3 is a possible future optimisation of Options 2/3 and is not specified here.

> **Licensing, should EX-SensorCAM code ever be reused.** EX-SensorCAM is **GPL-3.0**, not AGPL-3.0. GPLv3 §13 explicitly permits combination with an AGPLv3 work, so incorporating it into rails49 is permitted — but it is a distinct licence and must be recorded as one.

### Description

The `.r49` file carries additional information — layout title, owner, camera model (automatically detected?), scale. The UI provides means to view and edit it.

## Format

The `.r49` manifest is versioned. The current shipped version is 3; the model described above requires **version 4**, which is a breaking change: point markers are replaced by the three geometries above, and no automated migration is possible (a point carries neither extent nor orientation). A one-way import reads a v3 archive, carries images and calibration forward, and drops the labels.

The detector runs entirely in the browser via ONNX Runtime; the application is fully client-side with no backend.

---

*Design decisions, open questions, and the research behind them are tracked on the wayfinder map: [iot49/rails49#2](https://github.com/iot49/rails49/issues/2).*
