// What is measured here: the node goes to the RIGHT address with the RIGHT
// headers and body, and turns the server's answers into the right items.
//
// No n8n runtime and no network: a fake execution context stands in for
// IExecuteFunctions and records every httpRequest call. The compiled
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
      httpRequest: async (options) => {
        calls.push(options);
        const a = typeof answer === "function" ? answer(options) : answer;
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
  const report = { diagnostics: [], ozet: { error: 0 } };
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
  const png = await run({
    params: { resource: "barcode", operation: "barcode", data: "x", barcodeType: "qr", format: "png", binaryPropertyName: "qr" },
    answer: { body: Buffer.from("PNG") },
  });
  assert.deepEqual(png.ctx.calls[0].qs, { type: "qr", data: "x", format: "png" });
  assert.equal(png.items[0].binary.qr.mimeType, "image/png");
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
