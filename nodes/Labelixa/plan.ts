/**
 * Pure request planning: node parameters in, one HTTP request out.
 *
 * Kept apart from the n8n plumbing so it can be tested without an n8n
 * runtime, and so the addresses the node calls are visible in one place.
 * Every operation maps 1:1 to a documented endpoint:
 * https://labelixa.com/docs/api
 */

export const LANGUAGES = ['zpl', 'epl', 'tspl', 'cpcl'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface RenderParams {
	operation: 'render';
	code: string;
	language: Language;
	dpmm: number;
	widthIn: number;
	heightIn: number;
	index: number;
	rotation: number;
	outputFormat: 'png' | 'pdf';
	allLabels: boolean;
}

export interface ValidateParams {
	operation: 'validate';
	code: string;
	language: Language;
	dpmm: number;
	widthIn: number;
	heightIn: number;
}

export interface ConvertParams {
	operation: 'convertToEpl';
	code: string;
	dpmm: number;
	widthIn: number;
	heightIn: number;
}

export interface DetectParams {
	operation: 'detectLanguage';
	code: string;
}

export interface CompatibilityParams {
	operation: 'compatibility';
	code: string;
	model: string;
}

export interface BarcodeParams {
	operation: 'barcode';
	data: string;
	barcodeType: string;
	format: 'svg' | 'png';
}

export type Params =
	| RenderParams
	| ValidateParams
	| ConvertParams
	| DetectParams
	| CompatibilityParams
	| BarcodeParams;

export interface Plan {
	method: 'GET' | 'POST';
	path: string;
	qs: Record<string, string>;
	headers: Record<string, string>;
	body: string | undefined;
	/** Set when the answer is a file rather than JSON or text. */
	binary: { mimeType: string; extension: string } | null;
	/** Set when the answer is plain text (the EPL translation). */
	text: boolean;
}

/**
 * Formats a dimension the way the API path expects: 4 not 4.0, 2.25
 * unchanged. A locale-aware formatter would write 2,25 on a German or
 * Turkish machine and address a different label.
 */
export function number(value: number): string {
	if (!Number.isFinite(value)) {
		throw new Error(`label size must be a number, got ${String(value)}`);
	}
	return String(value);
}

function labelPath(dpmm: number, widthIn: number, heightIn: number, suffix: string): string {
	return `/v1/printers/${dpmm}dpmm/labels/${number(widthIn)}x${number(heightIn)}/${suffix}`;
}

export function planRequest(p: Params): Plan {
	switch (p.operation) {
		case 'render': {
			if (p.outputFormat === 'pdf') {
				return {
					method: 'POST',
					path: labelPath(p.dpmm, p.widthIn, p.heightIn, p.allLabels ? '' : String(p.index)),
					qs: {},
					headers: { Accept: 'application/pdf', 'Content-Type': 'text/plain' },
					body: p.code,
					binary: { mimeType: 'application/pdf', extension: 'pdf' },
					text: false,
				};
			}
			if (p.language === 'zpl') {
				const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
				if (p.rotation) {
					headers['X-Rotation'] = String(p.rotation);
				}
				return {
					method: 'POST',
					path: labelPath(p.dpmm, p.widthIn, p.heightIn, String(p.index)),
					qs: {},
					headers,
					body: p.code,
					binary: { mimeType: 'image/png', extension: 'png' },
					text: false,
				};
			}
			// EPL, TSPL and CPCL read the label size from the code itself.
			return {
				method: 'POST',
				path: `/v1/${p.language}/render`,
				qs: { index: String(p.index) },
				headers: { 'Content-Type': 'text/plain' },
				body: p.code,
				binary: { mimeType: 'image/png', extension: 'png' },
				text: false,
			};
		}
		case 'validate': {
			if (p.language === 'zpl') {
				// The endpoint reads the label size from w and h. Any other
				// spelling is ignored silently, so every check would quietly
				// run against the 4x6 default.
				return {
					method: 'POST',
					path: '/v1/diagnostics',
					qs: { dpmm: String(p.dpmm), w: number(p.widthIn), h: number(p.heightIn) },
					headers: { 'Content-Type': 'text/plain' },
					body: p.code,
					binary: null,
					text: false,
				};
			}
			return {
				method: 'POST',
				path: `/v1/${p.language}/diagnostics`,
				qs: {},
				headers: { 'Content-Type': 'text/plain' },
				body: p.code,
				binary: null,
				text: false,
			};
		}
		case 'convertToEpl':
			return {
				method: 'POST',
				path: labelPath(p.dpmm, p.widthIn, p.heightIn, ''),
				qs: {},
				headers: { Accept: 'application/epl', 'Content-Type': 'text/plain' },
				body: p.code,
				binary: null,
				text: true,
			};
		case 'detectLanguage':
			return {
				method: 'POST',
				path: '/v1/language-detect',
				qs: {},
				headers: { 'Content-Type': 'text/plain' },
				body: p.code,
				binary: null,
				text: false,
			};
		case 'compatibility':
			return {
				method: 'POST',
				path: '/v1/compatibility',
				qs: { model: p.model },
				headers: { 'Content-Type': 'text/plain' },
				body: p.code,
				binary: null,
				text: false,
			};
		case 'barcode':
			return {
				method: 'GET',
				path: '/v1/barcodes',
				qs: { type: p.barcodeType || 'code128', data: p.data, format: p.format || 'svg' },
				headers: {},
				body: undefined,
				binary: {
					mimeType: p.format === 'png' ? 'image/png' : 'image/svg+xml',
					extension: p.format === 'png' ? 'png' : 'svg',
				},
				text: false,
			};
		default: {
			const never: never = p;
			throw new Error(`unknown operation ${JSON.stringify(never)}`);
		}
	}
}

/**
 * Caps an error body: a message is a sentence, a broken proxy sends a
 * megabyte of HTML. The server's text is passed on verbatim (a JSON body
 * as its JSON), the same as the Labelixa SDKs do: wrapping it in a
 * friendlier sentence would hide the only words that say what is wrong.
 */
export function capMessage(body: unknown): string {
	let text: string;
	if (Buffer.isBuffer(body)) {
		text = body.toString('utf8');
	} else if (typeof body === 'string') {
		text = body;
	} else {
		text = JSON.stringify(body ?? '');
	}
	return text.length > 500 ? text.slice(0, 500) : text;
}

/**
 * Turns a non-200 answer into one sentence. 402 and 429 are named as quota
 * answers and carry the server's Retry-After, so a caller reading the
 * error knows to wait rather than retry immediately or give up.
 */
export function describeFailure(
	status: number,
	body: unknown,
	headers: Record<string, string | string[] | undefined>,
): string {
	const message = capMessage(body);
	if (status === 402 || status === 429) {
		const retry = headers['retry-after'] ?? headers['Retry-After'] ?? '60';
		const action = headers['x-quota-action'] ?? headers['X-Quota-Action'];
		return (
			`Labelixa quota answer (HTTP ${status}): ${message}. Retry after ${String(retry)} s` +
			(action ? ` (suggested action: ${String(action)})` : '')
		);
	}
	return `Labelixa answered HTTP ${status}: ${message}`;
}
