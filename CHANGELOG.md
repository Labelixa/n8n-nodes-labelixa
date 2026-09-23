# Changelog

All notable changes to this package are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-23

### Added
- `Labelixa` node with the Label resource (Render to PNG/PDF, Validate,
  Convert to EPL, Detect Language, Check Printer Compatibility) and the
  Barcode resource (Generate as SVG or PNG), each mapping to one
  documented REST endpoint.
- `Labelixa API` credential with an optional `lbx_` key (the free tier
  needs none) and a configurable base URL for on-premise deployments.
- Quota answers (402/429) surface as one sentence with the server's
  `Retry-After`; an invalid barcode (200 + `X-Warnings`) is an error, not
  a file.
