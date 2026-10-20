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
sent when the field is filled. **Test** checks the key against the API: a
wrong key fails (401), an empty key passes as the free tier.

The API address must be `https`; plain `http` is accepted only for
`localhost` (local development), and an address with a user name or
password in it is refused. Redirects are not followed: the API never
redirects, and following one would carry the `X-API-Key` header to
whichever host the redirect names. A redirect is reported as an error
that names its target.

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

Binary files are named `label-<item>.<ext>` (Render) and
`barcode-<item>.<ext>` (Barcode · Generate), where `<item>` is the
input item's index.

## Output field names

The API names some JSON fields in Turkish; those names are its stable wire
protocol. The node renames them to English after parsing, at any depth, so
a workflow reads `{{ $json.summary.total }}` rather than the wire name.
A few fields carry a code word from a fixed set, and those values are
English too: `risk.level` (`low`, `medium`, `high`), `risk.reasons`
(`native`, `emulation`, `no_zpl_support`, `size_finding`),
`model.category` (`desktop`, `industrial`, `mobile`),
`language_support.type` (`native`, `emulation`), `limitation`
(`risk_analysis`) and the Detect Language `evidence[].code` signals (for
example `zpl_command_density`, `epl_text_line`, `cpcl_header`). No other
value is changed: free text, rule codes such as `ZPL1001`, dates and any
code word the node does not know pass through as the API sent them, and so
does a field the node does not know. The complete maps ship with the
package in `dist/nodes/Labelixa/contract.js`.

| Operation | Output fields (English names) |
|---|---|
| Validate | `diagnostics[]`: `code`, `severity`, `message_key`, `message`, positions, `args` (e.g. `command`, `parameter`, `value`, `expected`, `actual`), `quickfix` (`title`, `title_key`, `offset`, `end_offset`, `replacement`), `preview`, `url`; `summary` (`total`, `error`, `warning`, `info`); `fields`; `rfid[]` (`operation`, `format`, `bank`, `data`) |
| Detect Language | `language`, `confidence`, `mixed`, `scores`, `evidence[]` (`code`, `line`) |
| Check Printer Compatibility | `model` (`manufacturer`, `model`, `category`, `dpi`), `language_support` (`type`, `evidence`, `source_url`, `verification`, `note`), `risk` (`level`, `reasons`), `has_size_rule`, `size_findings[]`, `preview_coverage` (`supported`, `partial`, `unsupported`, `ignored`, `unknown`), `limitation` |

Versions up to 0.1.3 returned the API's own names and values (for example
`ozet.toplam` for `summary.total`); an expression written against them
needs the new name or value.

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
npm run lint      # n8n's community node linter (@n8n/node-cli, strict mode)
npm test          # tsc build, icons, then node --test against dist/
```

The tests run the compiled node against a fake execution context — no
n8n runtime and no network — and check the address, headers and body of
every request plus the shape of every answer.

## License

MIT
