// What is measured here: the node goes to the RIGHT address with the RIGHT
// headers and body, and turns the server's answers into the right items.
//
// No n8n runtime and no network: a fake execution context stands in for
// IExecuteFunctions and records every authenticated request. The compiled
// output in dist/ is what runs, the same files n8n would load.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { Labelixa } = require(join(root, "dist/nodes/Labelixa/Labelixa.node.js"));
const { LabelixaApi } = require(join(root, "dist/credentials/LabelixaApi.credentials.js"));
const plan = require(join(root, "dist/nodes/Labelixa/plan.js"));
const contract = require(join(root, "dist/nodes/Labelixa/contract.js"));

const ZPL = "^XA^FO50,50^ADN,36,20^FDHello^FS^XZ";

/** A fake IExecuteFunctions: parameters in, recorded requests out. */
function context({ params, items = [{ json: {} }], apiKey = "lbx_test", baseUrl = "https://api.labelixa.com", answer, continueOnFail = false }) {
  const calls = [];
  const ctx = {
    calls,
    getInputData: () => items,
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
    getCredentials: async () => ({ apiKey, baseUrl }),
    getNode: () => ({ name: "Labelixa", type: "labelixa" }),
    continueOnFail: () => continueOnFail,
    helpers: {
      // n8n applies the credential's `authenticate` to the request, then
      // sends it; the fake does the same with the real credential class.
      httpRequestWithAuthentication: async (credentialType, options) => {
        assert.equal(credentialType, "labelixaApi");
        const authed = await new LabelixaApi().authenticate({ apiKey, baseUrl }, options);
        calls.push(authed);
        const a = typeof answer === "function" ? answer(authed) : answer;
        return { statusCode: 200, body: "OK", headers: {}, ...a };
      },
      prepareBinaryData: async (buffer, fileName, mimeType) => ({
        data: buffer.toString("base64"),
        fileName,
        mimeType,
      }),
    },
  };
  return ctx;
}

async function run(opts) {
  const ctx = context(opts);
  const node = new Labelixa();
  const out = await node.execute.call(ctx);
  return { ctx, items: out[0] };
}

test("package manifest points at files the build produces", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(pkg.keywords.includes("n8n-community-node-package"));
  for (const p of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
    assert.doesNotThrow(() => readFileSync(join(root, p)), `${p} missing from dist`);
  }
  assert.doesNotThrow(() => readFileSync(join(root, "dist/nodes/Labelixa/labelixa.svg")), "icon not copied");
  const node = new Labelixa();
  assert.equal(node.description.name, "labelixa");
  assert.equal(node.description.credentials[0].name, new LabelixaApi().name);
  assert.equal(node.description.icon, "file:labelixa.svg");
  // The credential icon path is relative to the compiled credential file.
  const credIcon = new LabelixaApi().icon.replace(/^file:/, "");
  assert.doesNotThrow(() => readFileSync(join(root, "dist/credentials", credIcon)), "credential icon missing");
});

test("render uses the Labelary-shaped path with headers, key and raw body", async () => {
  const { ctx, items } = await run({
    params: { resource: "label", operation: "render", code: ZPL, language: "zpl", outputFormat: "png" },
    answer: { body: Buffer.from("PNG"), headers: {} },
  });
  const req = ctx.calls[0];
  assert.equal(req.method, "POST");
  assert.equal(req.url, "https://api.labelixa.com/v1/printers/8dpmm/labels/4x6/0");
  assert.equal(req.headers["Content-Type"], "text/plain");
  assert.equal(req.headers["X-API-Key"], "lbx_test");
  assert.match(req.headers["X-Client"], /^n8n-nodes-labelixa\//);
  assert.equal(req.body, ZPL);
  assert.equal(req.encoding, "arraybuffer");
  assert.equal(items[0].binary.data.mimeType, "image/png");
  assert.equal(Buffer.from(items[0].binary.data.data, "base64").toString(), "PNG");
  assert.equal(items[0].json.warnings, "");
});

test("every binary request names the media type it expects in Accept", async () => {
  // n8n's HTTP helper defaults to Accept: application/json; the ZPL endpoint
  // then answers with the label's field list as JSON instead of the image.
  const cases = [
    [{ resource: "label", operation: "render", code: ZPL, language: "zpl", outputFormat: "png" }, "image/png"],
    [{ resource: "label", operation: "render", code: ZPL, language: "zpl", outputFormat: "pdf" }, "application/pdf"],
    [{ resource: "label", operation: "render", code: "N", language: "epl", outputFormat: "png" }, "image/png"],
    [{ resource: "barcode", operation: "barcode", barcodeType: "code128", data: "ABC" }, "image/svg+xml"],
    [{ resource: "barcode", operation: "barcode", barcodeType: "code128", data: "ABC", format: "png" }, "image/png"],
  ];
  for (const [params, mime] of cases) {
    const { ctx } = await run({ params, answer: { body: Buffer.from("X"), headers: { "content-type": mime } } });
    assert.equal(ctx.calls[0].headers.Accept, mime, JSON.stringify(params));
  }
});

test("a JSON answer to a PNG request is an error, not a .png file", async () => {
  const json = '{"toplam":1,"etiketler":[[]]}';
  await assert.rejects(
    run({
      params: { resource: "label", operation: "render", code: ZPL, language: "zpl", outputFormat: "png" },
      answer: { body: Buffer.from(json), headers: { "content-type": "application/json" } },
    }),
    /Expected image\/png from the API but got application\/json/,
  );
});

test("a fractional size keeps its decimals, an integer loses them", async () => {
  const { ctx } = await run({
    params: { resource: "label", operation: "render", code: ZPL, language: "zpl", outputFormat: "png", dpmm: 12, widthIn: 2.25, heightIn: 4, index: 1 },
  });
  assert.equal(ctx.calls[0].url, "https://api.labelixa.com/v1/printers/12dpmm/labels/2.25x4/1");
});

test("the rotation header is sent only when asked for", async () => {
  const a = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" } });
  assert.equal("X-Rotation" in a.ctx.calls[0].headers, false);
  const b = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png", rotation: 90 } });
  assert.equal(b.ctx.calls[0].headers["X-Rotation"], "90");
});

test("EPL, TSPL and CPCL use their own endpoint", async () => {
  for (const language of ["epl", "tspl", "cpcl"]) {
    const { ctx } = await run({
      params: { resource: "label", operation: "render", code: "N\nP1", language, outputFormat: "png", index: 2 },
    });
    assert.equal(ctx.calls[0].url, `https://api.labelixa.com/v1/${language}/render`);
    assert.deepEqual(ctx.calls[0].qs, { index: "2" });
  }
});

test("a PDF of every label drops the index and asks for the PDF media type", async () => {
  const { ctx, items } = await run({
    params: { resource: "label", operation: "render", code: ZPL, outputFormat: "pdf", allLabels: true },
    answer: { body: Buffer.from("%PDF") },
  });
  assert.equal(ctx.calls[0].url, "https://api.labelixa.com/v1/printers/8dpmm/labels/4x6/");
  assert.equal(ctx.calls[0].headers.Accept, "application/pdf");
  assert.equal(items[0].binary.data.mimeType, "application/pdf");
  const single = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "pdf", index: 3 } });
  assert.equal(single.ctx.calls[0].url, "https://api.labelixa.com/v1/printers/8dpmm/labels/4x6/3");
});

test("validation sends the parameters the server actually reads", async () => {
  const report = { diagnostics: [], summary: { error: 0 } };
  const { ctx, items } = await run({
    params: { resource: "label", operation: "validate", code: ZPL, language: "zpl", dpmm: 12, widthIn: 2.25, heightIn: 4 },
    answer: { body: report },
  });
  assert.equal(ctx.calls[0].url, "https://api.labelixa.com/v1/diagnostics");
  assert.deepEqual(ctx.calls[0].qs, { dpmm: "12", w: "2.25", h: "4" });
  assert.equal(ctx.calls[0].encoding, "json");
  assert.deepEqual(items[0].json, report);
  const tspl = await run({ params: { resource: "label", operation: "validate", code: "N", language: "tspl" }, answer: { body: report } });
  assert.equal(tspl.ctx.calls[0].url, "https://api.labelixa.com/v1/tspl/diagnostics");
});

test("a quota answer is one sentence with the server's delay and hint", async () => {
  await assert.rejects(
    run({
      params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
      answer: { statusCode: 429, body: Buffer.from("Daily quota exhausted"), headers: { "retry-after": "30", "x-quota-action": "upgrade" } },
    }),
    (e) => {
      assert.match(e.message, /HTTP 429/);
      assert.match(e.message, /Daily quota exhausted/);
      assert.match(e.message, /Retry after 30 s/);
      assert.match(e.message, /upgrade/);
      return true;
    },
  );
});

test("without Retry-After the delay falls back to 60", () => {
  assert.match(plan.describeFailure(402, "Add-on required", {}), /Retry after 60 s/);
});

test("400 is not a quota answer and keeps the server's message", async () => {
  await assert.rejects(
    run({
      params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
      answer: { statusCode: 400, body: Buffer.from("ZPL must start with ^XA") },
    }),
    (e) => {
      assert.equal(e.message, "Labelixa answered HTTP 400: ZPL must start with ^XA");
      assert.doesNotMatch(e.message, /quota/i);
      return true;
    },
  );
});

test("a long error body is capped", () => {
  const msg = plan.describeFailure(502, "x".repeat(2000), {});
  assert.ok(msg.length < 600, msg.length);
});

test("continueOnFail turns the failure into an item instead of a throw", async () => {
  const { items } = await run({
    params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
    answer: { statusCode: 500, body: Buffer.from("boom") },
    continueOnFail: true,
  });
  assert.match(items[0].json.error, /HTTP 500: boom/);
});

test("a barcode warning is an error, not a barcode", async () => {
  await assert.rejects(
    run({
      params: { resource: "barcode", operation: "barcode", data: "12", barcodeType: "ean13", format: "svg" },
      answer: { body: Buffer.from("<svg/>"), headers: { "x-warnings": "EAN-13 needs 12 or 13 digits" } },
    }),
    /Barcode not generated: EAN-13 needs 12 or 13 digits/,
  );
});

test("barcode defaults and query, returned as a file", async () => {
  const { ctx, items } = await run({
    params: { resource: "barcode", operation: "barcode", data: "ABC 123" },
    answer: { body: Buffer.from("<svg/>") },
  });
  assert.equal(ctx.calls[0].method, "GET");
  assert.equal(ctx.calls[0].url, "https://api.labelixa.com/v1/barcodes");
  assert.deepEqual(ctx.calls[0].qs, { type: "code128", data: "ABC 123", format: "svg" });
  assert.equal(items[0].binary.data.mimeType, "image/svg+xml");
  assert.equal(items[0].binary.data.fileName, "barcode-0.svg");
  assert.equal(items[0].json.fileName, "barcode-0.svg");
  const png = await run({
    params: { resource: "barcode", operation: "barcode", data: "x", barcodeType: "qr", format: "png", binaryPropertyName: "qr" },
    answer: { body: Buffer.from("PNG") },
  });
  assert.deepEqual(png.ctx.calls[0].qs, { type: "qr", data: "x", format: "png" });
  assert.equal(png.items[0].binary.qr.mimeType, "image/png");
  assert.equal(png.items[0].binary.qr.fileName, "barcode-0.png");
});

test("file names: barcode-<i> for barcodes, label-<i> for label renders", async () => {
  const two = [{ json: {} }, { json: {} }];
  const b = await run({
    params: { resource: "barcode", operation: "barcode", data: "x", format: "png" },
    items: two,
    answer: { body: Buffer.from("PNG") },
  });
  assert.deepEqual(b.items.map((i) => i.binary.data.fileName), ["barcode-0.png", "barcode-1.png"]);
  const png = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" }, items: two, answer: { body: Buffer.from("PNG") } });
  assert.deepEqual(png.items.map((i) => i.binary.data.fileName), ["label-0.png", "label-1.png"]);
  const pdf = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "pdf" }, answer: { body: Buffer.from("%PDF") } });
  assert.equal(pdf.items[0].binary.data.fileName, "label-0.pdf");
});

test("the EPL translation asks for the EPL media type and returns text", async () => {
  const { ctx, items } = await run({
    params: { resource: "label", operation: "convertToEpl", code: ZPL, dpmm: 12, widthIn: 2.25, heightIn: 4 },
    answer: { body: 'N\nA50,50,0,4,1,1,N,"Hello"\nP1\n' },
  });
  assert.equal(ctx.calls[0].url, "https://api.labelixa.com/v1/printers/12dpmm/labels/2.25x4/");
  assert.equal(ctx.calls[0].headers.Accept, "application/epl");
  assert.equal(ctx.calls[0].encoding, "text");
  assert.ok(items[0].json.epl.startsWith("N\n"));
});

test("compatibility passes the model through; language detection posts the code", async () => {
  const c = await run({
    params: { resource: "label", operation: "compatibility", code: ZPL, model: "zebra/zd421" },
    answer: { body: { risk: "low" } },
  });
  assert.equal(c.ctx.calls[0].url, "https://api.labelixa.com/v1/compatibility");
  assert.deepEqual(c.ctx.calls[0].qs, { model: "zebra/zd421" });
  assert.equal(c.ctx.calls[0].body, ZPL);
  const d = await run({
    params: { resource: "label", operation: "detectLanguage", code: ZPL },
    answer: { body: { language: "zpl", confidence: "high" } },
  });
  assert.equal(d.ctx.calls[0].url, "https://api.labelixa.com/v1/language-detect");
  assert.equal(d.items[0].json.confidence, "high");
});

test("an empty credential sends no key header at all", async () => {
  const { ctx } = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" }, apiKey: "" });
  assert.equal("X-API-Key" in ctx.calls[0].headers, false);
  assert.match(ctx.calls[0].headers["X-Client"], /^n8n-nodes-labelixa\//);
});

test("a trailing slash on the base address is not doubled", async () => {
  const { ctx } = await run({
    params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
    baseUrl: "https://labels.example.internal/",
  });
  assert.equal(ctx.calls[0].url, "https://labels.example.internal/v1/printers/8dpmm/labels/4x6/0");
});

test("every item gets its own request and its own output", async () => {
  const { ctx, items } = await run({
    params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
    items: [{ json: {} }, { json: {} }, { json: {} }],
    answer: { body: Buffer.from("PNG") },
  });
  assert.equal(ctx.calls.length, 3);
  assert.deepEqual(items.map((i) => i.pairedItem.item), [0, 1, 2]);
});

test("the credential exposes an optional key and the base URL", () => {
  const cred = new LabelixaApi();
  const names = cred.properties.map((p) => p.name);
  assert.deepEqual(names, ["apiKey", "baseUrl"]);
  assert.equal(cred.properties[0].typeOptions.password, true);
  assert.equal(cred.properties[1].default, "https://api.labelixa.com");
});

test("redirects are not followed, by the node or the credential test", async () => {
  const { ctx } = await run({ params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" } });
  assert.equal(ctx.calls[0].disableFollowRedirect, true);
  assert.equal(new LabelixaApi().test.request.disableFollowRedirect, true);
});

test("a redirect is an error that names its target", async () => {
  await assert.rejects(
    run({
      params: { resource: "label", operation: "render", code: ZPL, outputFormat: "png" },
      answer: { statusCode: 307, headers: { location: "https://evil.example/steal" } },
    }),
    /redirect \(HTTP 307\) to https:\/\/evil\.example\/steal/,
  );
});

test("plain http to another machine is refused before any request", async () => {
  const params = { resource: "label", operation: "render", code: ZPL, outputFormat: "png" };
  for (const baseUrl of ["http://api.labelixa.com", "http://10.0.0.5:8000", "https://api.labelixa.com@evil.example", "ftp://x", "not a url"]) {
    const ctx = context({ params, baseUrl });
    await assert.rejects(new Labelixa().execute.call(ctx), /base URL/, baseUrl);
    assert.equal(ctx.calls.length, 0, baseUrl);
  }
  for (const baseUrl of ["http://localhost:8000", "http://127.0.0.1:8000/", "http://[::1]:8000"]) {
    const { ctx } = await run({ params, baseUrl });
    assert.equal(ctx.calls.length, 1, baseUrl);
  }
});

test("the credential adds the key only when set and only to an accepted address", async () => {
  const auth = new LabelixaApi().authenticate;
  const key = async (apiKey, options) => (await auth({ apiKey }, { headers: {}, ...options })).headers["X-API-Key"];
  // Node requests carry a full URL.
  assert.equal(await key("lbx_k", { url: "https://api.labelixa.com/v1/capabilities" }), "lbx_k");
  assert.equal(await key(" lbx_k ", { url: "http://localhost:8000/v1/capabilities" }), "lbx_k");
  assert.equal(await key("", { url: "https://api.labelixa.com/v1/capabilities" }), undefined);
  assert.equal(await key("lbx_k", { url: "http://api.labelixa.com/v1/capabilities" }), undefined);
  assert.equal(await key("lbx_k", { url: "https://api.labelixa.com@evil.example/v1" }), undefined);
  // The credential test request carries baseURL + a relative path.
  assert.equal(await key("lbx_k", { baseURL: "https://api.labelixa.com", url: "/v1/capabilities" }), "lbx_k");
  assert.equal(await key("lbx_k", { baseURL: "http://10.0.0.5:8000", url: "/v1/capabilities" }), undefined);
  // The request it is given is not modified in place.
  const options = { url: "https://api.labelixa.com/v1/x", headers: { A: "1" } };
  await auth({ apiKey: "lbx_k" }, options);
  assert.deepEqual(options.headers, { A: "1" });
});

test("the credential test calls the capabilities endpoint on the configured base URL", () => {
  const { request } = new LabelixaApi().test;
  assert.equal(request.baseURL, "={{$credentials.baseUrl}}");
  assert.equal(request.url, "/v1/capabilities");
});

// ---- English output field names ------------------------------------------
// The fixtures below are answers measured on api.labelixa.com (trimmed). The
// API's JSON field names are a wire protocol and stay Turkish on the server;
// the node renames them, and only them.

const DIAG_ANSWER = {
  diagnostics: [
    {
      code: "ZPL1001", severity: "error", message_key: "diag.zpl1001", line: 5, col: 9, end_line: 5, end_col: 13,
      args: { komut: "^ZZ" },
      quickfix: { baslik_key: "fix.zpl1001", offset: 87, end_offset: 91, yeni: "", baslik: "Delete the unknown command" },
      mesaj: "Unknown command: ^ZZ", onizleme: { x: 10, y: 10 }, url: "https://labelixa.com/zpl/rules/ZPL1001",
    },
    {
      code: "ZPL6001", severity: "warning", message_key: "diag.zpl6001", line: 3, col: 1, end_line: 3, end_col: 11,
      args: { komut: "^FO", x: 700, y: 300, genislik: 406, yukseklik: 203 },
      mesaj: "^FO places the field at (700, 300)",
    },
    {
      code: "ZPL3002", severity: "warning", message_key: "diag.zpl3002", line: 6, col: 1, end_line: 7, end_col: 1,
      args: { komut: "^CI", parametre: "a", deger: 99, min: 0, max: 36 }, mesaj: "out of range",
    },
    {
      code: "EPL2001", severity: "warning", message_key: "diag.epl2001", line: 1, col: 1, end_line: 1, end_col: 1,
      args: { komut: "A", beklenen: 8, gelen: 3 }, mesaj: "A expects 8 fields, got 3 — skipped",
    },
  ],
  ozet: { toplam: 4, error: 1, warning: 3, info: 0 },
  alanlar: [{ line: 3, x: 700, y: 300 }, { line: 4, x: 10, y: 10 }],
  rfid: [{ line: 10, islem: "W", bicim: "H", banka: "E", veri: "1234" }],
};

test("Validate: every wire field name becomes English, nested arrays included", async () => {
  for (const language of ["zpl", "epl", "tspl", "cpcl"]) {
    const { items } = await run({
      params: { resource: "label", operation: "validate", code: ZPL, language },
      answer: { body: DIAG_ANSWER },
    });
    const j = items[0].json;
    assert.deepEqual(Object.keys(j), ["diagnostics", "summary", "fields", "rfid"], language);
    assert.deepEqual(j.summary, { total: 4, error: 1, warning: 3, info: 0 });
    const [unknown, outside, range, epl] = j.diagnostics;
    assert.deepEqual(unknown, {
      code: "ZPL1001", severity: "error", message_key: "diag.zpl1001", line: 5, col: 9, end_line: 5, end_col: 13,
      args: { command: "^ZZ" },
      quickfix: { title_key: "fix.zpl1001", offset: 87, end_offset: 91, replacement: "", title: "Delete the unknown command" },
      message: "Unknown command: ^ZZ", preview: { x: 10, y: 10 }, url: "https://labelixa.com/zpl/rules/ZPL1001",
    });
    assert.deepEqual(outside.args, { command: "^FO", x: 700, y: 300, label_width: 406, label_height: 203 });
    assert.deepEqual(range.args, { command: "^CI", parameter: "a", value: 99, min: 0, max: 36 });
    assert.deepEqual(epl.args, { command: "A", expected: 8, actual: 3 });
    assert.deepEqual(j.fields, [{ line: 3, x: 700, y: 300 }, { line: 4, x: 10, y: 10 }]);
    assert.deepEqual(j.rfid, [{ line: 10, operation: "W", format: "H", bank: "E", data: "1234" }]);
  }
  // The fixture itself is not modified in place.
  assert.equal(DIAG_ANSWER.ozet.toplam, 4);
});

test("Validate: a string body is parsed, then renamed", async () => {
  const { items } = await run({
    params: { resource: "label", operation: "validate", code: ZPL, language: "zpl" },
    answer: { body: JSON.stringify({ diagnostics: [], ozet: { toplam: 0 } }) },
  });
  assert.deepEqual(items[0].json, { diagnostics: [], summary: { total: 0 } });
});

test("Detect Language: English field names and evidence codes", async () => {
  const { items } = await run({
    params: { resource: "label", operation: "detectLanguage", code: ZPL },
    answer: {
      body: {
        dil: "zpl", guven: "medium", karma: true,
        puanlar: { zpl: 12, epl: 7, tspl: 0, cpcl: 0 },
        kanitlar: [{ kod: "zpl_xa", satir: 0 }, { kod: "zpl_komut_yogunlugu", satir: 0 }],
      },
    },
  });
  assert.deepEqual(items[0].json, {
    language: "zpl", confidence: "medium", mixed: true,
    scores: { zpl: 12, epl: 7, tspl: 0, cpcl: 0 },
    evidence: [{ code: "zpl_xa", line: 0 }, { code: "zpl_command_density", line: 0 }],
  });
});

test("Check Printer Compatibility: English field names and enum values", async () => {
  const sizeFinding = {
    code: "ZPL7002", severity: "warning", message_key: "diag.zpl7002", line: 1, col: 4, end_line: 1, end_col: 11,
    args: { model: "ZD421", gen: 2000, azami: 832 },
    mesaj: { en: "Print width 2000 dots exceeds ZD421's maximum", tr: "Baskı genişliği 2000 nokta", de: "Druckbreite" },
  };
  const { items } = await run({
    params: { resource: "label", operation: "compatibility", code: ZPL, model: "zebra/zd421" },
    answer: {
      body: {
        model: { uretici: "Zebra", model: "ZD421", kategori: "masaustu", dpi: [203, 300] },
        dil_postur: {
          tur: "native", evidence: "VENDOR_DOCUMENTATION", kaynak_url: "https://www.zebra.com/x.pdf", dogrulama: "2026-08-29",
          cihaz_seri: "S1", firmware: "V1", not: "ZSim",
        },
        risk: { seviye: "dusuk", gerekceler: ["native", "boyut_bulgusu"] },
        boyut_kurali_var: true,
        boyut_bulgulari: [sizeFinding],
        onizleme_kapsami: { destekli: ["A", "FO"], kismi: [], desteksiz: [], yok_sayilan: [], bilinmiyor: ["ZZ"] },
        sinir: "risk_analizi",
      },
    },
  });
  assert.deepEqual(items[0].json, {
    model: { manufacturer: "Zebra", model: "ZD421", category: "desktop", dpi: [203, 300] },
    language_support: {
      type: "native", evidence: "VENDOR_DOCUMENTATION", source_url: "https://www.zebra.com/x.pdf", verification: "2026-08-29",
      device_serial: "S1", firmware: "V1", note: "ZSim",
    },
    risk: { level: "low", reasons: ["native", "size_finding"] },
    has_size_rule: true,
    size_findings: [{
      code: "ZPL7002", severity: "warning", message_key: "diag.zpl7002", line: 1, col: 4, end_line: 1, end_col: 11,
      args: { model: "ZD421", print_width: 2000, maximum: 832 },
      message: sizeFinding.mesaj,
    }],
    preview_coverage: { supported: ["A", "FO"], partial: [], unsupported: [], ignored: [], unknown: ["ZZ"] },
    limitation: "risk_analysis",
  });
  // A model without ZPL support answers language_support: null.
  const none = await run({
    params: { resource: "label", operation: "compatibility", code: ZPL, model: "x/y" },
    answer: { body: { dil_postur: null, risk: { seviye: "yuksek", gerekceler: ["dil_yok"] } } },
  });
  assert.deepEqual(none.items[0].json, { language_support: null, risk: { level: "high", reasons: ["no_zpl_support"] } });
});

test("renaming: unknown keys pass through, values are never renamed, nothing is overwritten", () => {
  const { englishFields, FIELD_NAMES } = contract;
  const input = {
    brand_new_field: { nested: [{ mesaj: "kept as value: mesaj" }] },
    values: ["ozet", "dil", "mesaj"],
    ozet: "ozet",
    n: 0, t: true, z: null,
  };
  const before = JSON.stringify(input);
  assert.deepEqual(englishFields(input), {
    brand_new_field: { nested: [{ message: "kept as value: mesaj" }] },
    values: ["ozet", "dil", "mesaj"],
    summary: "ozet",
    n: 0, t: true, z: null,
  });
  assert.equal(JSON.stringify(input), before, "input is not modified in place");
  // An English key already present wins; the wire key is kept beside it.
  assert.deepEqual(englishFields({ message: "a", mesaj: "b" }), { message: "a", mesaj: "b" });
  assert.deepEqual(englishFields({ mesaj: "b", message: "a" }), { mesaj: "b", message: "a" });
  // Scalars and arrays at the top level.
  assert.equal(englishFields("dil"), "dil");
  assert.deepEqual(englishFields([{ dil: "zpl" }]), [{ language: "zpl" }]);
  // Inherited names are not mistaken for wire names.
  assert.deepEqual(englishFields({ toString: 1, constructor: 2 }), { toString: 1, constructor: 2 });
  // Every English name is plain ASCII snake case.
  for (const v of Object.values(FIELD_NAMES)) assert.match(v, /^[a-z][a-z_]*$/);
});

test("an error answer shows the server's sentence, not the wire field name", async () => {
  const sentence = "Model veritabaninda yok";
  for (const body of [{ hata: sentence }, Buffer.from(JSON.stringify({ hata: sentence })), JSON.stringify({ hata: sentence })]) {
    await assert.rejects(
      run({
        params: { resource: "label", operation: "compatibility", code: ZPL, model: "nope/none" },
        answer: { statusCode: 404, body },
      }),
      (e) => {
        assert.equal(e.message, `Labelixa answered HTTP 404: ${sentence}`);
        assert.doesNotMatch(e.message, /hata/);
        return true;
      },
    );
  }
  const quota = plan.describeFailure(429, { hata: "Rate limit" }, { "retry-after": "5" });
  assert.equal(quota, "Labelixa quota answer (HTTP 429): Rate limit. Retry after 5 s");
  // Other bodies are passed on as before.
  assert.equal(plan.describeFailure(500, { detail: "x" }, {}), 'Labelixa answered HTTP 500: {"detail":"x"}');
  assert.equal(plan.describeFailure(500, "not json", {}), "Labelixa answered HTTP 500: not json");
  const { items } = await run({
    params: { resource: "label", operation: "detectLanguage", code: ZPL },
    answer: { statusCode: 400, body: { hata: "Empty body" } },
    continueOnFail: true,
  });
  assert.deepEqual(items[0].json, { error: "Labelixa answered HTTP 400: Empty body" });
});

test("enum values: every mapped value per field, unknown values pass through", () => {
  const { englishFields } = contract;
  const compat = (body) => englishFields(body);
  for (const [wire, en] of [["dusuk", "low"], ["orta", "medium"], ["yuksek", "high"], ["critical", "critical"]]) {
    assert.equal(compat({ risk: { seviye: wire } }).risk.level, en);
  }
  assert.deepEqual(
    compat({ risk: { gerekceler: ["native", "emulasyon", "dil_yok", "boyut_bulgusu", "yeni_gerekce"] } }).risk.reasons,
    ["native", "emulation", "no_zpl_support", "size_finding", "yeni_gerekce"],
  );
  for (const [wire, en] of [["masaustu", "desktop"], ["endustriyel", "industrial"], ["mobil", "mobile"], ["kiosk", "kiosk"]]) {
    assert.equal(compat({ model: { kategori: wire } }).model.category, en);
  }
  const support = compat({ dil_postur: { tur: "emulasyon", evidence: "VENDOR_EMULATION_DOCUMENTATION", dogrulama: "2026-09-02" } });
  assert.deepEqual(support.language_support, { type: "emulation", evidence: "VENDOR_EMULATION_DOCUMENTATION", verification: "2026-09-02" });
  assert.equal(compat({ dil_postur: { tur: "native" } }).language_support.type, "native");
  assert.equal(compat({ sinir: "risk_analizi" }).limitation, "risk_analysis");
  assert.equal(compat({ sinir: "baska" }).limitation, "baska");
  const codes = {
    zpl_xa: "zpl_xa", zpl_xz: "zpl_xz", zpl_komut_yogunlugu: "zpl_command_density", zpl_tilde: "zpl_tilde",
    epl_metin_satiri: "epl_text_line", epl_barkod_satiri: "epl_barcode_line", epl_kontrol_satiri: "epl_control_line",
    tspl_mm_boyut: "tspl_mm_size", tspl_kelime: "tspl_keyword", cpcl_baslik: "cpcl_header", cpcl_kelime: "cpcl_keyword",
    yeni_sinyal: "yeni_sinyal",
  };
  const detected = englishFields({ kanitlar: Object.keys(codes).map((kod, satir) => ({ kod, satir })) });
  assert.deepEqual(detected.evidence.map((e) => e.code), Object.values(codes));
  assert.deepEqual(detected.evidence.map((e) => e.line), Object.keys(codes).map((_, i) => i));
});

test("enum values: only the listed fields; free text, rule codes and other fields are untouched", () => {
  const { englishFields } = contract;
  const note = "ZSim — Honeywell'in ZPL II emulasyonu (dusuk risk)";
  const out = englishFields({
    dil_postur: { tur: "native", not: note, kaynak_url: "https://x/emulasyon" },
    risk: { seviye: "orta" },
    boyut_bulgulari: [{ code: "ZPL7002", severity: "warning", mesaj: { tr: "dusuk", en: "low" }, args: { model: "dusuk" } }],
    diagnostics: [{ code: "ZPL1001", args: { komut: "dusuk", deger: "masaustu" }, mesaj: "emulasyon" }],
    // The same words at other paths are not enum fields there.
    level: "dusuk",
    category: "masaustu",
    reasons: ["emulasyon"],
    language_support_note: "risk_analizi",
    code: "zpl_komut_yogunlugu",
    preview_coverage: { supported: ["A"], unknown: ["ZZ"] },
  });
  assert.equal(out.language_support.note, note);
  assert.equal(out.language_support.source_url, "https://x/emulasyon");
  assert.equal(out.risk.level, "medium");
  assert.deepEqual(out.size_findings[0], { code: "ZPL7002", severity: "warning", message: { tr: "dusuk", en: "low" }, args: { model: "dusuk" } });
  assert.deepEqual(out.diagnostics[0], { code: "ZPL1001", args: { command: "dusuk", value: "masaustu" }, message: "emulasyon" });
  assert.equal(out.level, "dusuk");
  assert.equal(out.category, "masaustu");
  assert.deepEqual(out.reasons, ["emulasyon"]);
  assert.equal(out.language_support_note, "risk_analizi");
  assert.equal(out.code, "zpl_komut_yogunlugu");
  assert.deepEqual(out.preview_coverage, { supported: ["A"], unknown: ["ZZ"] });
  // Inherited names are neither fields nor values.
  assert.equal(englishFields({ risk: { seviye: "toString" } }).risk.level, "toString");
});
