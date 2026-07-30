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

**Option 3 is what the live path uses; option 2 is retained but not loaded.** The two are fed from the same labels (see [Location Data](#location-data-cars-and-sensors)), and the CNN answers a genuinely different question — "is this specific point occupied" versus "where is every car" — but [Occupancy Output](#occupancy-output) makes the per-sensor answer a pure geometric consequence of the detector's boxes, which leaves the CNN with no consumer in the live view. So only the detector ships: one model in the bundle, one ORT session, one vocabulary. The classifier package, `TRAIN.ipynb`, and the derived-crop pipeline all survive, so the ResNet stays retrainable and can be revived if the detector disappoints. Proving the detector happens offline through `pnpm --filter dataset online-diagnostics`, not by running both models live. Settled in [issue #7](https://github.com/iot49/rails49/issues/7).

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

## Occupancy Output

Settled in [issue #7](https://github.com/iot49/rails49/issues/7). The system reports **two layers and no more**:

| | What it is | Source |
| :--- | :--- | :--- |
| **L0** | Every detected car: pose, class, confidence — exactly as the detector emitted it | the model |
| **L1** | Per-sensor state: `occupied` / `clear` / `unknown` | pure geometry over L0 |

**L1 never calls a second model.** It is a pure function of L0, so it cannot contradict the boxes drawn beside it, it needs no second inference, and it costs the same whether a layout has three sensors or three hundred — the detector runs once per frame regardless. There is consequently no disagreement rule to specify.

Everything above L1 — event and transition semantics (Rocrail's enter/in sensors fire on *transitions*, not per-frame state) and block-span occupancy — is deliberately unspecified. L0 carries full car pose, so those remain computable later from archives recorded today.

### The occupancy test

A sensor is `occupied` when a detection's oriented box **strictly contains** its point. No tolerance epsilon: any value would be unvalidatable, the lateral direction already carries ~1.4 m prototype of slack from the derived width, and at a coupler the two boxes abut on a shared endpoint so a point between coupled cars is already inside one of them. A real gap between uncoupled cars should read `clear`, and an epsilon would manufacture a phantom there.

The box tested is **width-normalized**: centre, orientation and length come from the detector, but the DPT-derived per-class constant **replaces the predicted width**. Width is not observed data — it is a per-class constant with no per-label override (see [Location Data](#location-data-cars-and-sensors)), so every training label carries the same width and the model's width output is a fit to a constant. Its deviation is pure error, and directional: at DPT 20 in HO a car is ~39 px wide, so a centreline sensor sits ~19 px inside the boundary; an under-predicted 25 px width cuts that to ~12 px and can flip a covered sensor to `clear`. Substituting the constant only ever widens an under-predicted box, which is the safe direction. **L0 still reports the raw predicted box** — normalization belongs to L1's geometry, not to the detector's output.

> ⚠️ **Known limitation: long cars on tight curves.** The box's long axis is the chord between the car's endpoints, but track bows off that chord by the sagitta `L²/8R`. Once that exceeds the half-width (16.1 mm in HO), a sensor near the car's **midpoint** falls outside the box. The ends still register, so a long car crossing a sensor reads occupied → clear → occupied.
>
> | Car length (prototype) | Fails below radius |
> | :--- | :--- |
> | 40–50 ft freight | ~9" — never in practice |
> | 69 ft | 18" |
> | 80 ft | 24" |
> | 85 ft passenger / autorack | **27"** |
>
> Accepted rather than fixed: first tests are short cars on straight track. **The mitigation is a constant, not code** — inflate the class width in `config.yaml`. Covering an 85 ft car on an 18" radius needs a half-width ≥ 24.2 mm, i.e. ~48 mm against the prototype's 32 mm (~1.5×).
>
> The alternative — projecting onto the track spline and testing arc-length overlap — was rejected. Cost was never the objection (~8,000 distance evaluations, tens of µs against 377,000 µs of inference). It trades this *bounded, quantified* failure for an unbounded one: "nearest spline" is ambiguous exactly where layouts are densest — parallel sidings (~60 px apart at DPT 20), turnouts, yard ladders — and a mis-association reports the **wrong track** occupied, at a rate nothing can bound. (It is also now unbuildable as stated: [issue #13](https://github.com/iot49/rails49/issues/13) removed track geometry from v4, so there is no spline to project onto.)

### The vocabulary

| State | When |
| :--- | :--- |
| `occupied` | any detection above the threshold covers the point — **including low-confidence ones** |
| `clear` | no detection covers the point |
| `unknown` | the system **cannot answer**: sensor outside the frame, DPT unresolved, model not loaded, or camera drift detected ([issue #12](https://github.com/iot49/rails49/issues/12)) |

**`unknown` is never a confidence outcome.** It means "I was unable to look", not "I looked and I'm unsure" — which is what keeps it genuinely distinct from `clear`.

**Errors are biased toward `occupied`, deliberately.** A missed car costs a collision; a phantom costs "why do trains never go there". This matches prototype practice: real track circuits are wired so that a failure shows occupied. Every case where the model *did* look and saw something therefore resolves to `occupied`, which is why no "unsure" confidence band exists.

The bias reduces the *consequence* of the worse error. It does not make this a safety interlock; the constraint above stands unchanged.

**Accepted consequence:** a persistent phantom `occupied` is worse than cosmetic. A permanently blocked block is never entered and never cleared, so it can **deadlock a controller's schedule**. Weighed against a collision and accepted.

### Confidence

Every L0 detection carries its confidence, and an `occupied` L1 state carries the confidence of the covering detection (the maximum, where several overlap).

**`clear` carries no confidence — absent, not `0.0` and not `1.0`.** `occupied` is evidenced by a specific detection; `clear` is the *absence* of evidence, and nothing scored it. `0.0` would read as "definitely not occupied" and `1.0` as "definitely clear"; both claim a measurement that was never made. This matters because the system's two error modes are asymmetric in *inspectability*: a phantom arrives with a confidence a consumer can threshold, while **a miss arrives as a confident-looking `clear` with nothing behind it**. Leaving that confidence absent is the only encoding that does not hide the distinction.

A **single** confidence threshold, a named constant in `config.yaml` alongside `crop_size` and the DPT threshold. Two properties of it:

* **Thresholding is decoding, not filtering.** The detector's export is `end2end: True` with output `[1, 300, 7]` — a fixed 300-slot buffer emitted every frame, mostly padding. There is no version of L0 that skips the threshold.
* **It has a floor above zero.** At 0 you accept 300 phantom cars blanketing the frame, so every sensor reads `occupied` on every frame and the system reports nothing at all. The value must sit low but above the padding noise, and it can only be found by measuring recall against a held-out split — which does not yet exist for either model (see [Accuracy](#accuracy)).

The fail-safe bias lives in **L1**. L0 stays raw, so a consumer wanting a stricter reading can re-threshold the same frame's data without fighting the default.

> ⚠️ **A total miss stays invisible.** No single-model scheme makes it detectable. Two thresholds do not; nor does adding a track class — a missed car with confidently-detected track under it is a *confident false clear*, worse than an unevidenced one, and the two failure modes are correlated so it is not an independent check. Only a genuinely independent second observer would close this: a CNN verifier over the same points, or [change detection](#secondary-uses-of-change-detection). Neither is specified, and neither is worth building before the detector has held-out numbers.

### Output encoding

L0 detections are reported in **`camera.resolution` pixel coordinates**: centre `{x, y}`, length px, width px, orientation in **radians from the +x axis**, plus class and confidence.

That frame is chosen because it is the only stable one. The model's input resolution (960×544) is selected by geometry and changes on re-export; the video's natural size varies per device and camera; normalized 0…1 coordinates sever the link to DPT, which is px/mm. `camera.resolution` is the frame sensors, labels, and calibration are *already* authored in — so the point-in-box test needs no conversion, the SVG viewBox maps 1:1 onto it so boxes draw over the video with no transform, and any length converts to millimetres with one DPT multiply. No millimetre field is stored; it is one multiply away.

**Off-track detections pass through untouched.** A sensor is placed on track by the person who wants an answer there, so a box far from any track contains no sensor and cannot change any L1 verdict — there is nothing to protect. Filtering would need the spline association rejected above — which is now doubly unavailable, since v4 stores no track geometry at all — would make L0 not raw, and would destroy real information: a box around a car sitting in the scenery tells a human something (a false positive, a derailment, a hand over the layout, or a car on unlabeled track) that a suppressed box does not. Confidence, not geometry, is the right filter for junk — a spurious detection is characteristically low-confidence, whereas a genuine car on unlabeled track is confident and should survive.

**Sensor identity: consumers key on `id`; `name` is optional passthrough, absent when unset and never auto-generated.** ids survive edits; names are free text, are not unique, and a controller mapping keyed on one breaks the moment someone renames it. An auto-generated "Sensor 3" is worse than none — indistinguishable from a name a human chose, and it silently stops matching as sensors are added and removed. The optional `name` exists for Rocrail and for humans who cannot remember hex strings; the UI displays the `id` as fallback. No uniqueness is enforced.

**Couplings are not reported.** They are derivable from L0 — two detected box endpoints coinciding — and adding a field or a class for them would restate what the geometry already says.

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

### Location Data: Cars and Sensors

The `.r49` format and UI editor store and edit **two** distinct kinds of geometry in pixel coordinates. They differ in scope and in whether the model ever sees them:

| | Geometry | Scope | Trained on? | Provenance? |
|---|---|---|---|---|
| **Cars** | Two points along the car's centerline | Per **image** | **Yes** — the detector's only class | **Yes** |
| **Sensors** | Single point | Per **layout** | **No** — an output specification | No |

1. **Cars.** Cars are straight and of standard width (2.8 m prototype), so a car is fully described by **two points** along its centerline; width is derived from the scale rather than stored. Trains are sequences of cars where the end of one coincides with the start of the next — so **couplings need not be labeled or detected**, they are derivable from abutting car endpoints. Each car carries [provenance](#provenance-is-required-not-optional).

2. **Sensors** (block detectors). Points where occupancy must be reported when running trains. These are an *output specification*, not training data: they say where the deployed system must answer, and they never enter a loss function. What they answer *with* is [Occupancy Output](#occupancy-output). They remain **points**, not spans: a span would match a prototype block more closely, but L0 carries full car pose so block semantics stay derivable later, whereas authoring intervals is real UI for a consumer not yet observable. Sensors carry **no** provenance — no model can propose where a human wants an answer, so the field would be permanently `human` and therefore noise.

#### Track is not stored, and that is a deliberate deferral

**There was a third geometry — track, as per-layout splines — and it is not in v4.** Settled in [issue #13](https://github.com/iot49/rails49/issues/13).

Track turned out to have **no live-path consumer**. It is not a detector class and never enters a loss; [Occupancy Output](#occupancy-output) tests a point against the detector's oriented boxes and explicitly rejects associating detections with a spline; and its remaining use — generating empty-track CNN crops — is dormant because only the detector ships. That left one live use, snapping cars to the centerline while authoring.

Decisively, **track is fully retrofittable**: it is layout-scoped, the camera is fixed within an archive, and the images persist, so splines can be authored into an existing archive at any later date **without invalidating a single car label**. That is the exact inverse of provenance, which cannot be recovered after the fact — and it is why one is deferred and the other is provisioned now.

So cars are authored as two free clicks on the visible car ends. Dropping the snap may even *help* label quality: the user can see the actual car in the photograph, whereas a snap projects onto a spline that may itself be slightly off, and the detector's orientation output comes from the car's true axis.

**What this costs, stated plainly:** the derived empty-track training crops described in [issue #4](https://github.com/iot49/rails49/issues/4) are unobtainable while track is deferred. That is owed back only if the ResNet is revived.

Track authoring returns as a **fresh effort**, not a resumption — see the closed [issue #14](https://github.com/iot49/rails49/issues/14), which records the questions (spline creation, control-point editing, Catmull-Rom versus Bezier, turnouts, whether track carries topology) that remain genuinely open.

#### Labeling completeness

Every image used for detector training must have **all** of its cars labeled. An object present but unlabeled is treated as background by the loss, so partial labeling actively teaches the detector that cars are background. This cannot be scoped per class — the loss is shared across a whole image.

Each image therefore carries a **completeness flag**, `labeled_complete`; only complete images are exported for training. Incomplete images remain useful for authoring and review. That per-image geometry does get skipped in practice is already on record: `cars 0-10.r49` has 32 track markers on image-0 and **zero** on its other ten images.

**`labeled_complete` means exactly one thing: a human asserts that no car in this image is unlabeled.** It is an assertion about *absence*, which is why it cannot be replaced by anything per-label — see [Provenance](#provenance-is-required-not-optional). **Accepting model proposals never sets it**, however many are accepted; marking an image complete stays a separate deliberate act. Scanning for what the model **missed** is a different act from judging what it proposed, and only the first can back this flag.

An image marked complete with **zero** car labels is legitimate, not a gap — it is an all-background sample.

### Labeling Workflow

The editor guides a specific order, because the order is what keeps a training set honest:

1. **Calibrate** — two points minimum.
2. **Label all cars** — per image.

Sensors can be placed at any time.

> The workflow was three stages until [issue #13](https://github.com/iot49/rails49/issues/13) removed track from v4. Stage 2 was *label all track*, and it is gone along with the snap that depended on it.

**Stages are gated on existence, never on completion.** Calibration gates car labeling, because car width is derived from DPT and the width rectangle is the only feedback that a label actually covers what it claims. Every stage stays re-enterable, and nothing can verify that *all* cars have been labeled, so nothing pretends to — the flow is encouraged by ordering, and the one honest claim of exhaustiveness is the human's, recorded as `labeled_complete`.

A **car-free image** is no longer a required convention. It was worth having on three grounds — track was authored on it, it was the cleanest source of empty-track CNN crops, and it is a valid complete image with zero cars. The first is gone with track and the second is dormant, so only the third survives: a car-free image makes a useful all-background sample, and nothing more is claimed for it.

#### Authoring cars, and the trains they form

A car is **two free clicks on the visible car ends** — the straight chord between them, along the car's own centerline. There is no snapping, because there is no stored track to snap to.

A train is authored as a **chain of clicks**: the first click starts a car, and every click after it is simultaneously the end of the current car and the start of the next. **Right-click ends the chain**, and the next click starts a new train. Nothing about the train is stored — it stays derived from coincident endpoints. Chaining simply guarantees that the coincidence is exact.

Because a coupling is where two endpoints coincide, it renders as **one shared handle**: dragging it moves both cars' endpoints together, so a train survives editing. Deleting a single car remains possible as an error-correction path — deleting the middle car of three leaves two derived trains, with no residue.

Dragging edits everything: car endpoints, coupler joints, calibration points, and sensors.

#### Right-click is state-dependent

| State | Right-click |
| :-- | :-- |
| Chaining a train | Ends the chain |
| Idle | Context menu on the object under the cursor |

The context menu carries **delete** and **reclassify**, and it is the reason the editor needs no delete mode at all. It is also where a dotted class taxonomy belongs: `stock › loco › steam` nests as a submenu rather than requiring a persistent picker. A newly created car is `stock`; refinement happens through the menu.

One gesture meaning two things depending on state is a real cost, accepted here because the two states differ by whether a chain is in progress — which is already loudly visible as a rubber band.

#### No copy-forward

Labels are not carried between images. Copying cars across a set where nothing moves was considered and rejected: hand-labeling every image is what keeps provenance and the completeness flag unambiguous.

### Assisted Labeling

Hand-labeling every car in every image is the dominant cost of building a training set. Once a detector exists, the UI should **propose** car labels, which the user then edits, corrects, or rejects. The human remains the author; the model supplies a first draft.

**One model, not two.** An earlier draft anticipated a second, separate model for authoring, because a proposal model would also need to detect **track** in order to suggest the spline layout. Track is no longer stored ([issue #13](https://github.com/iot49/rails49/issues/13)), so that reason is gone: the authoring aid is the production detector itself, same class set and same weights. **Bootstrapping dissolves with it** — the circularity was that a track-proposing model needs track labels to train on, which is what it was meant to produce. Nothing about proposing cars is circular: hand-label enough images, train, then propose.

The provenance and completeness rules below are what keep the aid from quietly degrading the corpus, and they hold regardless of which model does the proposing.

#### Provenance is required, not optional

Accepted proposals that later become training data create a feedback loop: the model trains on its own output and amplifies its own errors, including systematic ones a user is unlikely to catch — a plausible proposal is easy to accept without scrutiny.

Each **car** label therefore records how it came to exist, plus which model proposed it:

| Field | Value |
|---|---|
| `provenance` | `human` — drawn by hand |
| | `proposed` — model-proposed, accepted without modification |
| | `corrected` — model-proposed, then edited by the user |
| `proposed_by` | the proposing model's version string (`v1.0.0`-style); **absent** when `provenance` is `human` |

This makes the difference measurable: unedited proposals can be excluded or down-weighted when building a training set, and acceptance rate becomes a quality signal. **Provenance cannot be retrofitted** once a corpus is labeled, which is why it is provisioned before the feature that needs it exists.

Three details that were decided against, and why:

* **`corrected` records no magnitude**, and the original proposal is not retained. Correction data would be **censored**: residuals exist only where the user chose to edit, `proposed` labels have zero residual by construction, and errors nobody noticed leave no residual at all. It would measure "how far the user moved what they moved" while looking exactly like model error. Model error belongs to a held-out evaluation — see [Accuracy](#accuracy).
* **`proposed_by` is per-label, not per-image.** Re-proposing an image with a newer model leaves the previous run's `corrected` labels in place, so an image-scoped field would be false about some of its own labels — and retraining is precisely the workflow that creates that case.
* **`corrected` stays distinct from `human`.** A corrected label was *anchored* by a proposal, and anchoring bias is real: a user who nudges is not a user who drew.

#### Provenance cannot cover the error that matters most

Provenance is **per-label**, so there is one thing it structurally cannot express: a car that was **never labeled at all**. A proposal model that misses a car yields an image where every present label is impeccable and a car is silently taught as background — the exact poisoning [Labeling completeness](#labeling-completeness) exists to prevent.

That risk lives in `labeled_complete` and nowhere else, because completeness is an assertion about *absence*. It is also **not computable** from provenance: an image whose labels are all `proposed` is byte-identical whether the user inspected every one and agreed, or clicked accept-all blind. This is why accepting proposals must never set the flag.

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
