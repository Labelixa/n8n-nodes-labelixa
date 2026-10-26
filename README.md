# n8n-nodes-labelixa

An [n8n](https://n8n.io) community node for [Labelixa](https://labelixa.com):
render, validate and convert thermal printer label code — ZPL, EPL, TSPL
and CPCL — generate barcodes, and queue print jobs for printers connected
through the Labelixa agent.

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
| Print Job · Print Label | queues raw label code for a device or a printer group (`POST /v1/print`), with an Idempotency-Key | JSON (`job_id`, `status`, ...) |
| Print Job · Get Print Status | where a queued job is now (`GET /v1/print/jobs/{id}`) | JSON |

Every operation maps 1:1 to a documented REST endpoint and there are no
hidden retries: a retry that swallows a quota answer turns a clear signal
into a slow mystery. <https://labelixa.com/docs/api> is the source of
truth.

## Printing

Print Label needs an API key whose plan includes printing, and a printer
connected through the Labelixa agent. The node queues the job; the agent
delivers it to the printer.

**Nothing here confirms a printed label.** A raw printer connection
reports that bytes were accepted, not that paper came out (media out, an
open head or a jam happen afterwards). The furthest a job gets is
`dispatched` — the bytes were delivered — and every print item carries
`print_confirmed: false`.

**Idempotency-Key.** Every Print Label request carries one. When the same
request arrives again with the same key, the server returns the first
answer (the item shows `replayed: true`) instead of queuing a second job.

- Default: `n8n-<execution id>-<node id>-<item index>`. n8n's *Retry On
  Fail* re-runs the node inside the same execution, so a retried item
  sends the same key and cannot print twice. A new execution (a new
  trigger, or re-running a failed execution from the list) gets a new key.
- *Options → Idempotency Key*: your own key, for example
  `{{ $json.orderId }}-label`, also protects across executions. Up to
  255 visible ASCII characters. Re-using a key with a different request
  is refused (HTTP 422); a new job needs a new key.

**Failures say whether a job may exist** (`outcome` on the item with
*Continue On Fail*):

| Answer | Meaning | `retryable` | `outcome` |
|---|---|---|---|
| 402 | printing not on the plan, or the free print allowance is used up — not retried | false | `not_queued` |
| 400, 401, 403, 404, 422 | permanent: the request, key, plan, device or group needs fixing | false | `not_queued` |
| 429 | rate limit or full print queue; `retry_after_seconds` from `Retry-After` | true | `not_queued` |
| 409 | the same key is still being processed; retry after `retry_after_seconds` | true | `unknown` |
| 5xx, timeout, dropped connection | the job may or may not have been queued | true | `unknown` |

On `unknown` the node does **not** print again and you should not send
the label as a new job: re-send with the same key (safe — the server
replays the first answer, which carries the `job_id`), then check it with
Get Print Status. The item also carries `idempotency_key`. *Options →
Timeout (Seconds)* sets how long Print Label waits (default 30).

**Get Print Status** returns `status`, a plain `status_meaning`, `final`
(nothing changes any more: `dispatched`, `failed`, `cancelled`) and
`needs_attention` (`failed`, `uncertain`):

| `status` | Meaning |
|---|---|
| `queued` | accepted and waiting; no agent has taken it yet |
| `dispatching` | an agent is handing it to the printer |
| `dispatched` | the bytes were delivered to the printer — not a print confirmation |
| `failed` | delivery failed; check `stage` and `copies_sent` first, since re-sending a partly delivered job prints those copies twice |
| `cancelled` | cancelled, will not be delivered |
| `uncertain` | the job reached the agent but no result came back; whether anything reached the printer is not known. Never retried automatically; `warning_code` is `delivery_uncertain`. Check the printer, and if the label is missing print it as a new job with a new key |

Other fields: `stage`, `copies`, `copies_sent`, `reached_printer`, an
English `stage_summary`, `error_type` (the API's error code, passed on as
sent), `device_id`, `device`, `charged`, `agent_last_seen`, and
`printer_status` (`health`: `ready`, `blocked` or `unknown`; `basis`:
`reported` by the printer or `inferred`; `flags` such as `head_open` or
`media_out`; `finished_inference`) — `null` when the printer was not asked.

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

Print Label has its own rules (see [Printing](#printing)); for the other
operations:

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
