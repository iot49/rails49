# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with ui code in this repository.

The ui is a static webapp written with [Lit Element](https://lit.dev/) and [Shoelace Styling](https://shoelace.style/).

It implements the SPEC.md.

## Coding Standards

* Strongly typed TypeScript: avoid "any" as much as practical
* Styles go into css section of Lit components; avoid inline styles
* Compose app from "small" Lit components. 
  * Document each component with a short description of its purpose and its interface (attributes)
  * Add examples as needed for clarification
  * Add test to verify the full functionality including visual appearance and interaction (e.g. canvas clicks)
* Add tests that verify the entire app in a browser
* Support the main browsers: Google Chrome, Apple Safari, Firefox. Do not constrain features by limitations imposed by other browsers.