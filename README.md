# n8n-nodes-labelixa

An [n8n](https://n8n.io) community node for [Labelixa](https://labelixa.com):
render, validate and convert thermal printer label code — ZPL, EPL, TSPL
and CPCL — and generate barcodes, without a printer.

## Install

In n8n: **Settings → Community Nodes → Install**, package name
`n8n-nodes-labelixa`. Self-hosted from the shell:

```sh
npm install n8n-nodes-labelixa
```

Requires n8n 1.x. The package has no runtime dependencies.

## Credential

**Labelixa API** — an optional `lbx_` key from the
[Labelixa panel](https://labelixa.com/panel) and the API address
(`https://api.labelixa.com`, or your own instance). Leave the key empty
for the free tier: rate limited per IP, no watermark. The header is only
sent when the field is filled.

## Operations

| Resource · operation | What it does | Output |
|---|---|---|
| Label · Render | one label as PNG (ZPL, EPL, TSPL, CPCL), or ZPL as PDF — optionally every label in one document | binary file |
| Label · Validate | the linter's structured report (diagnostics with code, severity, position; summary counts) | JSON |
| Label · Convert to EPL | ZPL translated to EPL2 | `epl` text |
| Label · Detect Language | which printer language raw code is, with a confidence tier | JSON |
| Label · Check Printer Compatibility | risk against a printer model, e.g. `zebra/zd421` (a risk report, not an emulator) | JSON |
| Barcode · Generate | a standalone barcode or QR code as SVG or PNG | binary file |

Every operation maps 1:1 to a documented REST endpoint and there are no
hidden retries: a retry that swallows a quota answer turns a clear signal
into a slow mystery. <https://labelixa.com/docs/api> is the source of
truth.

## Errors worth knowing

- **Quota (HTTP 402 / 429)** — the node fails with one sentence that
  carries the server's `Retry-After` and its hint (`upgrade`, `addon`),
  so a Wait node downstream can back off for exactly that long. Turn on
  *Continue On Fail* to get the message as an `error` field instead.
- **Invalid barcode** — the API answers 200 with an error image and an
  `X-Warnings` header. The node treats that as an error, so an unusable
  image never reaches a printer.
- **Render warnings** — `X-Warnings` on a render (an unknown command, a
  field off the label) is passed on in the item's `warnings` field next
  to the binary.

## Sizes

Width and height are inches; `2.25` keeps its decimals, `4` stays `4`.
Density is dots per millimetre (8 dpmm = 203 dpi). A whole-document PDF
costs one quota unit per label, a server rule this node states rather
than softens.

## Development

```sh
npm install
npm test          # tsc build, icons, then node --test against dist/
```

The tests run the compiled node against a fake execution context — no
n8n runtime and no network — and check the address, headers and body of
every request plus the shape of every answer.

## License

MIT
