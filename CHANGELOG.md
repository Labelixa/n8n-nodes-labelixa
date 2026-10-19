# Changelog

All notable changes to this package are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-10-19

### Fixed
- Rendering ZPL to PNG inside n8n returned a 98-byte file that was not an
  image. n8n's HTTP helper sends `Accept: application/json` by default, and
  the ZPL endpoint answers that header the way Labelary does: with the
  label's field list as JSON. Every binary request now sends the media type
  it expects (`image/png`, `application/pdf`, `image/svg+xml`).
- A response whose content type does not match the expected file type is
  now an error that quotes the server's answer, instead of a file saved
  under the wrong extension.

## [0.1.1] - 2026-10-19

### Security
- Redirects are no longer followed, by the node or by the credential test.
  n8n's HTTP stack strips only `Authorization` and `Cookie` when a
  redirect changes host, so the `X-API-Key` header would have been
  carried to whatever address the redirect pointed at. A redirect is now
  an error that names its target.
- The base URL must be `https`; plain `http` is accepted only for
  `localhost` and loopback addresses, and a URL with a user name or
  password is refused. The node stops before sending anything.
- The credential test sends the key only to an `https` base URL.

### Fixed

- Trailing slashes in the base URL are stripped with a loop instead of `/\/+$/` (polynomial backtracking).

## [0.1.0] - 2026-09-23

### Added
- `Labelixa` node with the Label resource (Render to PNG/PDF, Validate,
  Convert to EPL, Detect Language, Check Printer Compatibility) and the
  Barcode resource (Generate as SVG or PNG), each mapping to one
  documented REST endpoint.
- Credential test (`GET /v1/capabilities`): a wrong key fails with 401,
  an empty key passes as the free tier.
- `Labelixa API` credential with an optional `lbx_` key (the free tier
  needs none) and a configurable base URL for on-premise deployments.
- Quota answers (402/429) surface as one sentence with the server's
  `Retry-After`; an invalid barcode (200 + `X-Warnings`) is an error, not
  a file.
