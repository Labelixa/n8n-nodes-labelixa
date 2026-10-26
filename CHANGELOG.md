# Changelog

All notable changes to this package are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-10-26

### Added
- **Print Job · Print Label** (`POST /v1/print`): queues raw label code
  (ZPL, EPL, TSPL, CPCL or raw bytes) for a device or a printer group, with
  copies, an optional printer language, the number of labels in the
  payload and an optional source render job.
- **Print Job · Get Print Status** (`GET /v1/print/jobs/{id}`): the job's
  status (`queued`, `dispatching`, `dispatched`, `failed`, `cancelled`,
  `uncertain`) with a plain `status_meaning`, `final`, `needs_attention`,
  an English `stage_summary`, the printer's own report as
  `printer_status`, and `warning_code: "delivery_uncertain"` with its
  warning for an uncertain job.
- A print answer that names a saved label passes its id on as `label_id`.
- Every Print Label request sends an `Idempotency-Key`. By default it is
  derived from the n8n execution id, the node and the item index, so
  n8n's *Retry On Fail* re-sends the same key and cannot queue a second
  job; the *Idempotency Key* option takes your own key (for example an
  order number) to protect across executions as well.
- Print failures say whether a job may exist: HTTP 402 (plan or free
  print allowance) and other 4xx answers are permanent and not retried;
  HTTP 429 carries the server's `Retry-After`; a timeout, a dropped
  connection or a 5xx answer is reported as "outcome unknown" with the
  advice to re-send with the same key, never as a reason to print again.
  With *Continue On Fail* the item carries `retryable`,
  `retry_after_seconds`, `outcome` and `idempotency_key`.
- A *Timeout (Seconds)* option for Print Label (default 30).
- No print answer is ever reported as printed: Labelixa cannot confirm
  that a label physically came out of a printer, so `print_confirmed` is
  always `false` and `dispatched` means the bytes were delivered.

## [0.1.4] - 2026-10-20

### Changed
- **The JSON output of Validate, Detect Language and Check Printer
  Compatibility uses English field names.** Some field names in the API's
  answers are Turkish; they are the API's stable wire names and stay as
  they are on the server, so the node renames them after parsing, at any
  depth: for example `ozet.toplam` is now `summary.total`, `mesaj` is
  `message`, `dil`/`guven` are `language`/`confidence`, and
  `risk.seviye` is `risk.level`. The full map is in the README.
- The code-word values of a few fields are English as well: `risk.level`
  (`dusuk`/`orta`/`yuksek` are now `low`/`medium`/`high`),
  `risk.reasons`, `model.category`, `language_support.type`, `limitation`
  and the Detect Language `evidence[].code` signals. Free text, rule codes,
  dates and unknown values are not changed, and a field the node does not
  know passes through unchanged.
- **Both changes alter the output shape:** an expression that reads an old
  name or value (for example `{{ $json.ozet.toplam }}` or a comparison
  with `"dusuk"`) must be updated to the new one.
- An error answer's message is the server's sentence alone, without the
  JSON field it arrives in.

### Fixed
- Barcode · Generate named its file `label-0.png`; it is now
  `barcode-<item>.png` or `barcode-<item>.svg`. Label renders keep
  `label-<item>.<ext>`.

## [0.1.3] - 2026-10-19

### Added
- `npm run lint` runs the official n8n community node linter
  (`@n8n/node-cli`, strict mode with the default ESLint configuration), and
  the package passes it with no errors.
- A GitHub Actions publish workflow: a version tag (`vX.Y.Z`) builds, lints
  and tests the package, then publishes it to npm with a provenance
  statement through npm Trusted Publishing (OIDC, no stored npm token).
- The credential now shows the Labelixa icon.

### Changed
- The API key is added by the credential's `authenticate` method and the
  node sends its requests through n8n's authenticated request helper. The
  rule is unchanged: the `X-API-Key` header is sent only when a key is set,
  and only to `https` or to plain `http` on localhost. The credential test
  follows the same rule, so it now also sends the key to a local `http`
  instance, as the node already did.
- Options are listed alphabetically, and the density and size fields read
  "Print Density", "Width in Inches" and "Height in Inches" (DPI written
  out per option). Parameter names and values are unchanged, so existing
  workflows keep working.
- An unexpected error (for example a network failure) is reported as an n8n
  node error against the failing item; the message is unchanged.
- Development dependencies: `n8n-workflow` 2.42.2 for types (it pins a
  patched `form-data`), which replaces the `overrides` entry that the n8n
  linter does not allow in community node packages.

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
