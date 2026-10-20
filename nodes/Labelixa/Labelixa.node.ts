import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { capMessage, checkBaseUrl, describeFailure, planRequest, type Language, type Params } from './plan';

const VERSION = '0.1.3';

const showFor = (operations: string[], resource = 'label') => ({
	show: { resource: [resource], operation: operations },
});

const sizeProperties = (operations: string[]) => [
	{
		displayName: 'Print Density',
		name: 'dpmm',
		type: 'options' as const,
		options: [
			{ name: '6 Dots/mm (152 DPI)', value: 6 },
			{ name: '8 Dots/mm (203 DPI)', value: 8 },
			{ name: '12 Dots/mm (300 DPI)', value: 12 },
			{ name: '24 Dots/mm (600 DPI)', value: 24 },
		],
		default: 8,
		displayOptions: showFor(operations),
	},
	{
		displayName: 'Width in Inches',
		name: 'widthIn',
		type: 'number' as const,
		default: 4,
		description: 'Label width in inches; 2.25 keeps its decimals',
		displayOptions: showFor(operations),
	},
	{
		displayName: 'Height in Inches',
		name: 'heightIn',
		type: 'number' as const,
		default: 6,
		displayOptions: showFor(operations),
	},
];

export class Labelixa implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Labelixa',
		name: 'labelixa',
		icon: 'file:labelixa.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
		description:
			'Render, validate and convert ZPL, EPL, TSPL and CPCL label code, and generate barcodes, without a printer',
		defaults: { name: 'Labelixa' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'labelixaApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Label', value: 'label' },
					{ name: 'Barcode', value: 'barcode' },
				],
				default: 'label',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['label'] } },
				options: [
					{
						name: 'Check Printer Compatibility',
						value: 'compatibility',
						action: 'Check ZPL against a printer model',
						description: 'Risk report for a printer model such as zebra/zd421 (a risk report, not an emulator)',
					},
					{
						name: 'Convert to EPL',
						value: 'convertToEpl',
						action: 'Translate ZPL to EPL2',
						description: 'ZPL translated to EPL2; fields that cannot carry over are listed as warnings in the output',
					},
					{
						name: 'Detect Language',
						value: 'detectLanguage',
						action: 'Detect the printer language of raw code',
						description: 'Which of ZPL, EPL, TSPL or CPCL the code is, with a confidence tier',
					},
					{
						name: 'Render',
						value: 'render',
						action: 'Render a label to PNG or PDF',
						description: 'One label as PNG, or ZPL as PDF (optionally every label in one document)',
					},
					{
						name: 'Validate',
						value: 'validate',
						action: 'Validate label code',
						description: "The linter's structured report: diagnostics with code, severity and position",
					},
				],
				default: 'render',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['barcode'] } },
				options: [
					{
						name: 'Generate',
						value: 'barcode',
						action: 'Generate a barcode',
						description: 'A standalone barcode or QR code as SVG or PNG',
					},
				],
				default: 'barcode',
			},

			// ---- label: shared -------------------------------------------------
			{
				displayName: 'Label Code',
				name: 'code',
				type: 'string',
				typeOptions: { rows: 6 },
				default: '',
				required: true,
				placeholder: '^XA^FO50,50^A0N,40,40^FDHello^FS^XZ',
				description: 'The raw label code (ZPL, EPL, TSPL or CPCL)',
				displayOptions: showFor(['render', 'validate', 'convertToEpl', 'detectLanguage', 'compatibility']),
			},
			{
				displayName: 'Language',
				name: 'language',
				type: 'options',
				options: [
					{ name: 'ZPL', value: 'zpl' },
					{ name: 'EPL', value: 'epl' },
					{ name: 'TSPL', value: 'tspl' },
					{ name: 'CPCL', value: 'cpcl' },
				],
				default: 'zpl',
				description: 'Density and size apply to ZPL; EPL, TSPL and CPCL carry the size in the code',
				displayOptions: showFor(['render', 'validate']),
			},

			// ---- label: render -------------------------------------------------
			{
				displayName: 'Output Format',
				name: 'outputFormat',
				type: 'options',
				options: [
					{ name: 'PNG', value: 'png' },
					{ name: 'PDF (ZPL Only)', value: 'pdf' },
				],
				default: 'png',
				displayOptions: showFor(['render']),
			},
			...sizeProperties(['render', 'validate', 'convertToEpl']),
			{
				displayName: 'Label Index',
				name: 'index',
				type: 'number',
				default: 0,
				description: 'Which label of a multi-label document to draw (0-based)',
				displayOptions: showFor(['render']),
			},
			{
				displayName: 'All Labels in One PDF',
				name: 'allLabels',
				type: 'boolean',
				default: false,
				description:
					'Whether to put every label of the document in one PDF. Costs one quota unit per label.',
				displayOptions: { show: { resource: ['label'], operation: ['render'], outputFormat: ['pdf'] } },
			},
			{
				displayName: 'Rotation',
				name: 'rotation',
				type: 'options',
				options: [
					{ name: '0°', value: 0 },
					{ name: '90°', value: 90 },
					{ name: '180°', value: 180 },
					{ name: '270°', value: 270 },
				],
				default: 0,
				displayOptions: { show: { resource: ['label'], operation: ['render'], outputFormat: ['png'] } },
			},
			{
				displayName: 'Put Output in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary field to hold the rendered file',
				displayOptions: showFor(['render']),
			},

			// ---- label: compatibility -----------------------------------------
			{
				displayName: 'Printer Model',
				name: 'model',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'zebra/zd421',
				description: 'As manufacturer/model; both parts are read case-insensitively',
				displayOptions: showFor(['compatibility']),
			},

			// ---- barcode ---------------------------------------------------------
			{
				displayName: 'Data',
				name: 'data',
				type: 'string',
				default: '',
				required: true,
				description: 'The text to encode',
				displayOptions: showFor(['barcode'], 'barcode'),
			},
			{
				displayName: 'Barcode Type',
				name: 'barcodeType',
				type: 'options',
				options: [
					{ name: 'Code 128', value: 'code128' },
					{ name: 'Code 39', value: 'code39' },
					{ name: 'Data Matrix', value: 'datamatrix' },
					{ name: 'EAN-13', value: 'ean13' },
					{ name: 'EAN-8', value: 'ean8' },
					{ name: 'GS1-128', value: 'gs1-128' },
					{ name: 'Interleaved 2 of 5', value: 'itf' },
					{ name: 'PDF417', value: 'pdf417' },
					{ name: 'QR Code', value: 'qr' },
					{ name: 'UPC-A', value: 'upca' },
				],
				default: 'code128',
				displayOptions: showFor(['barcode'], 'barcode'),
			},
			{
				displayName: 'Format',
				name: 'format',
				type: 'options',
				options: [
					{ name: 'SVG', value: 'svg' },
					{ name: 'PNG', value: 'png' },
				],
				default: 'svg',
				displayOptions: showFor(['barcode'], 'barcode'),
			},
			{
				displayName: 'Put Output in Field',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary field to hold the barcode file',
				displayOptions: showFor(['barcode'], 'barcode'),
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		const credentials = (await this.getCredentials('labelixaApi')) as {
			apiKey?: string;
			baseUrl?: string;
		};
		let baseUrl: string;
		try {
			baseUrl = checkBaseUrl(credentials.baseUrl);
		} catch (e) {
			// Before any item: nothing, and no key, is sent to a bad address.
			throw new NodeOperationError(this.getNode(), (e as Error).message);
		}

		for (let i = 0; i < items.length; i++) {
			try {
				const params = readParams(this, i);
				const plan = planRequest(params);
				const headers: Record<string, string> = {
					...plan.headers,
					// Usage is attributed to the integration, never to a person.
					'X-Client': `n8n-nodes-labelixa/${VERSION}`,
				};
				// n8n's HTTP helper sends `Accept: application/json` unless told
				// otherwise, and the ZPL endpoint honours it the way Labelary does:
				// it answers with the label's field list as JSON instead of the
				// image. A binary request therefore always names the media type it
				// expects.
				if (plan.binary && !headers.Accept) {
					headers.Accept = plan.binary.mimeType;
				}
				// The X-API-Key header is added by the credential's `authenticate`
				// (only when a key is set, and only towards an address the node
				// accepts).
				const response = (await this.helpers.httpRequestWithAuthentication.call(this, 'labelixaApi', {
					method: plan.method,
					url: baseUrl + plan.path,
					qs: plan.qs,
					headers,
					body: plan.body,
					encoding: plan.binary ? 'arraybuffer' : plan.text ? 'text' : 'json',
					returnFullResponse: true,
					ignoreHttpStatusErrors: true,
					// The API never redirects. Following one would carry the
					// X-API-Key header to whatever host the redirect names: the
					// HTTP stack strips only Authorization and Cookie on a
					// cross-host redirect. A 3xx surfaces as an error below.
					disableFollowRedirect: true,
				})) as {
					statusCode: number;
					body: unknown;
					headers: Record<string, string | string[] | undefined>;
				};

				if (response.statusCode !== 200) {
					throw new NodeOperationError(
						this.getNode(),
						describeFailure(response.statusCode, response.body, response.headers),
						{ itemIndex: i },
					);
				}
				const warnings = String(
					response.headers['x-warnings'] ?? response.headers['X-Warnings'] ?? '',
				);

				if (plan.binary) {
					if (params.operation === 'barcode' && warnings) {
						// Invalid input is not a 4xx: the server answers 200 with an
						// error image. Handing that back as a barcode would be lying.
						throw new NodeOperationError(
							this.getNode(),
							`Barcode not generated: ${warnings}`,
							{ itemIndex: i },
						);
					}
					const contentType = String(
						response.headers['content-type'] ?? response.headers['Content-Type'] ?? '',
					);
					if (contentType && !contentType.startsWith(plan.binary.mimeType)) {
						// Saving a JSON or HTML body under a .png name gives the
						// workflow a file that only fails much later, far from the cause.
						throw new NodeOperationError(
							this.getNode(),
							`Expected ${plan.binary.mimeType} from the API but got ${contentType}: ${capMessage(response.body)}`,
							{ itemIndex: i },
						);
					}
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', i, 'data') as string;
					const fileName = `label-${i}.${plan.binary.extension}`;
					const buffer = Buffer.from(response.body as ArrayBuffer);
					out.push({
						json: { warnings, bytes: buffer.length, fileName },
						binary: {
							[binaryPropertyName]: await this.helpers.prepareBinaryData(
								buffer,
								fileName,
								plan.binary.mimeType,
							),
						},
						pairedItem: { item: i },
					});
					continue;
				}

				if (plan.text) {
					out.push({
						json: { epl: String(response.body), warnings },
						pairedItem: { item: i },
					});
					continue;
				}

				let json = response.body as IDataObject;
				if (typeof json === 'string') {
					json = JSON.parse(json) as IDataObject;
				}
				out.push({ json, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: i },
					});
					continue;
				}
				// A NodeOperationError is passed through unchanged by this
				// constructor; anything else (a network failure, a malformed JSON
				// body) is wrapped so n8n shows it against the failing item.
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}
}

function readParams(ctx: IExecuteFunctions, i: number): Params {
	const resource = ctx.getNodeParameter('resource', i) as string;
	if (resource === 'barcode') {
		return {
			operation: 'barcode',
			data: ctx.getNodeParameter('data', i) as string,
			barcodeType: ctx.getNodeParameter('barcodeType', i, 'code128') as string,
			format: ctx.getNodeParameter('format', i, 'svg') as 'svg' | 'png',
		};
	}
	const operation = ctx.getNodeParameter('operation', i) as string;
	const code = ctx.getNodeParameter('code', i) as string;
	const size = () => ({
		dpmm: Number(ctx.getNodeParameter('dpmm', i, 8)),
		widthIn: Number(ctx.getNodeParameter('widthIn', i, 4)),
		heightIn: Number(ctx.getNodeParameter('heightIn', i, 6)),
	});
	switch (operation) {
		case 'render': {
			const outputFormat = ctx.getNodeParameter('outputFormat', i, 'png') as 'png' | 'pdf';
			return {
				operation: 'render',
				code,
				language: ctx.getNodeParameter('language', i, 'zpl') as Language,
				...size(),
				index: Number(ctx.getNodeParameter('index', i, 0)),
				rotation:
					outputFormat === 'png' ? Number(ctx.getNodeParameter('rotation', i, 0)) : 0,
				outputFormat,
				allLabels:
					outputFormat === 'pdf' ? Boolean(ctx.getNodeParameter('allLabels', i, false)) : false,
			};
		}
		case 'validate':
			return {
				operation: 'validate',
				code,
				language: ctx.getNodeParameter('language', i, 'zpl') as Language,
				...size(),
			};
		case 'convertToEpl':
			return { operation: 'convertToEpl', code, ...size() };
		case 'detectLanguage':
			return { operation: 'detectLanguage', code };
		case 'compatibility':
			return { operation: 'compatibility', code, model: ctx.getNodeParameter('model', i) as string };
		default:
			throw new NodeOperationError(ctx.getNode(), `Unknown operation "${operation}"`, {
				itemIndex: i,
			});
	}
}
