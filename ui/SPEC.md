# Model Railroad Track Occupancy Detection with Cameras

## Goals

* Detect presence of trains at specific locations in a layout (**block detection**)
* Detect location, size (length), and orientation of all trains in a layout (**track occupancy detection**)

## Assumption

Humans can reliably control model railroad trains (and real prototype trains) using primarily visual information. **AI should be able to do the same.**

## Classifier

A classifier is used to establish track occupancy. Solutions include:

1. **Image change.** Images taken subsequently differ as trains move. Requires no training and very little compute. The [EX-SensorCAM](https://dcc-ex.com/mkdocs-test/products/ex-sensorcam/ex-sensorcam/) project uses an ESP32 and an inexpensive camera for this. The project gives little information about accuracy, and in practice other sources of change — illumination above all — are very difficult to distinguish reliably from moving trains. If those problems can be overcome the approach is very attractive.
2. **CNN.** A ResNet or MobileNet recognizing the presence or absence of a train at a specific location. Block detection only. This is what ships today.
3. **Object detector.** A detector such as YOLO that finds the location and orientation of every railroad car on the layout. This gives the most complete information.

Options 2 and 3 are complementary rather than exclusive: the detector answers "where is every car", the CNN answers "is this specific point occupied". Both are fed from the same labels (see [Location Data](#location-data-track-cars-sensors)).

> **Note on terminology:** YOLO performs *detection* (oriented bounding boxes), not *segmentation* (per-pixel masks). Detection is what this application needs.

## Accuracy

Extremely high accuracy is required to avoid collisions and other problems.

Classifiers can be trained per layout, so only modest generalization is needed — recognizing trains at layout positions absent from the training data, or rolling stock the model has not seen. On that basis >99.9% should be achievable. (Still not sufficient for prototype trains, where accidents are far more costly.)

> ⚠️ **The currently reported 99.58% is not a generalization estimate.** The regression test iterates every marker in every archive, so roughly 770 of its 963 samples were seen during training. It is a *reproducibility* check — does this `.ort` still behave like the published one — not a held-out measurement. Any >99.9% target needs a held-out evaluation that does not yet exist. See issue #4.

**Safety:** nothing here may be presented as a safety interlock. The classifier does sometimes miss rolling stock and report phantom trains.

## Features

The UI provides an interface to create, visualize, and edit `.r49` files via the library in `../lib/r49`. The sections below describe the requirements.

### Images

`.r49` files contain a list of images of the model layout taken with an overhead camera. The UI allows acquiring and removing images.

### Calibration

#### Establishes the relation (scale) to the prototype

Supports common track geometries (HO, N, Z, etc).

#### Establishes the relation between image pixels and physical dimensions

To avoid recognizing objects at different scales, the app uses **DPT** (dots per track width) as the relation between pixel and physical coordinates.

**Example.** Two points in an N-scale layout are 1000 pixels apart in the image and 250 mm apart on the physical layout, giving 1000/250 = **4 dots per millimeter**. Track width in N scale is `STANDARD_GAUGE/160 = 1435/160 ≈ 9 mm` (`STANDARD_GAUGE` is defined in the `.r49` library). Hence **DPT = 4 × 9 = 36** dots per track width for this image.

In practice **DPT > 20** is required: below that, a car is too few pixels across for the detector to localize reliably, and the CNN's crop covers too little of the track to be discriminative. The corpus measured so far sits at DPT 18–19, i.e. marginally under this threshold.

> **Consequence — UI development and training data are decoupled.** The existing 46 images are below the DPT threshold and need re-shooting, which is not currently possible. They remain perfectly adequate as **UI fixtures**: they exercise every code path in the editor and cost nothing. **Training will use fresh, higher-DPT images captured later.** Do not tune model accuracy against the current corpus, and do not treat its numbers as predictive.

Ideally the layout is perfectly parallel to the camera plane. Then it suffices to specify the distance in millimeters between two points at the same height to establish DPT. Otherwise the image suffers perspective distortion, and several points in 3D space are required to compute the correcting transform.

In practice the errors from camera misalignment have been negligible and **two-point calibration is sufficient**, so that is what the UI uses. However the `.r49` format accepts a list of **3D coordinate points** (relative to an arbitrary but fixed origin) so full calibration remains possible later without another format change.

Other errors, such as camera barrel distortion, are ignored.

#### Image Alignment

For pixel data to map to the same layout location, the camera position must not change across images or during classification. **For now we assume this holds.** Workarounds — aligning images on structural details such as track and landscape features, fiducial markers, or simply *detecting* drift and refusing to classify — are tracked in [issue #12](https://github.com/iot49/rails49/issues/12). Note the current failure mode is silent: nothing records the camera pose and nothing notices when it changes.

> Measured: within an archive the camera *is* static. `lighting.r49` has a track marker at (202, 591) in image-0 and (202, 592) in image-1. But calibration is currently **shared verbatim across archives** — the three `cars *` archives carry byte-identical calibration — which may be a data-entry error rather than a genuinely identical rig. See issue #6.

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

### Description

The `.r49` file carries additional information — layout title, owner, camera model (automatically detected?), scale. The UI provides means to view and edit it.

## Format

The `.r49` manifest is versioned. The current shipped version is 3; the model described above requires **version 4**, which is a breaking change: point markers are replaced by the three geometries above, and no automated migration is possible (a point carries neither extent nor orientation). A one-way import reads a v3 archive, carries images and calibration forward, and drops the labels.

The detector runs entirely in the browser via ONNX Runtime; the application is fully client-side with no backend.

---

*Design decisions, open questions, and the research behind them are tracked on the wayfinder map: [iot49/rails49#2](https://github.com/iot49/rails49/issues/2).*
