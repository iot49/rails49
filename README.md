# 🚂 Rails49

Computer vision suite for model railroaders to detect track occupancy using deep neural networks.

---

## 🌟 Overview

This project provides a camera-based solution for track occupancy detection based on overhead cameras and CNN-based image classification to identify trains and rolling stock. Although the approach has inherent limitations, the goal is to achieve very high reliability as to minimize the chances of collisions or other malfunctions.

**WARNING**: Although the software has been designed with the goal to be reliable, the ultimate responsibility for safe model railroad operation rests with the user. In particular, the software in some instances fails to detect rolling stock or detect trains where there are none.

The application is offered as a static webapp served at https://rails49.org/. When run from a mobile device with an attached camera (e.g. a smartphone) it shows the locations of detected trains in the browser.

## 🤝 Contributing

See [CLAUDE.md](CLAUDE.md) for the repository layout, development commands, and
the technology stack, and [lib/CLAUDE.md](lib/CLAUDE.md) for the interface
convention the shared TypeScript libraries follow.

Pull requests are welcome. By contributing you agree that your contributions
are licensed under the [MIT License](LICENSE), the same terms that cover the
rest of the project.

