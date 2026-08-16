# 🚂 Rails49

Computer vision suite for model railroaders to detect track occupancy using deep neural networks.

---

## 🌟 Overview

This project provides a camera-based solution for track occupancy detection based on overhead cameras and CNN-based image classification to identify trains and rolling stock. Although the approach has inherent limitations, the goal is to achieve very high reliability as to minimize the chances of collisions or other malfunctions.

**WARNING**: Although the software has been designed with the goal to be reliable, the ultimate responsibility for safe model railroad operation rests with the user. In particular, the software in some instances fails to detect rolling stock or detect trains where there are none.

The application is offered as a static webapp served at https://occupancy.rails49.org/. When run from a mobile device with an attached camera (e.g. a smartphone) it shows the locations of detected trains in the browser.

## 🤝 Contributing

See [SPEC.md](SPEC.md) for what the system is meant to do and why — the requirements,
the `.r49` format, and the reasoning behind the design. Much of it is the target rather
than a description of what ships today.

See [CLAUDE.md](CLAUDE.md) for the repository layout, development commands, and
the technology stack, and [lib/CLAUDE.md](lib/CLAUDE.md) for the interface
convention the shared TypeScript libraries follow.

Pull requests are welcome. By contributing you agree that your contributions
are licensed under the [GNU Affero General Public License v3.0](LICENSE), the
same terms that cover the rest of the project. There is no CLA.

## 📄 License

Copyright (C) 2026 Bernhard Boser

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version. See [LICENSE](LICENSE) for the full text.

The project is AGPL-3.0 because it ships a detector derived from
[Ultralytics YOLO](https://github.com/ultralytics/ultralytics), which is
AGPL-3.0 licensed; trained weights inherit those terms. If you deploy a
modified version, the licence requires you to make your source available to
its users.

