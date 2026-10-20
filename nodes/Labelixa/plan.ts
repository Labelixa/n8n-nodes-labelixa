/**
 * Pure request planning: node parameters in, one HTTP request out.
 *
 * Kept apart from the n8n plumbing so it can be tested without an n8n
 * runtime, and so the addresses the node calls are visible in one place.
 * Every operation maps 1:1 to a documented endpoint:
 * https://labelixa.com/docs/api
 */

import { ERROR_FIELD } from './contract';

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
	} else if (body instanceof ArrayBuffer) {
		text = Buffer.from(body).toString('utf8');
	} else if (typeof body === 'string') {
		text = body;
	} else {
		text = JSON.stringify(body ?? '');
	}
	return text.length > 500 ? text.slice(0, 500) : text;
}

/**
 * The server's own sentence from an error answer. The API sends errors as
 * one JSON field (see ERROR_FIELD); its text is passed on, not the JSON
 * around it, so the wire field name never shows up in a message. Any other
 * body is passed on as it is.
 */
export function errorText(body: unknown): string {
	let parsed: unknown = body;
	if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof ArrayBuffer) {
		const text = typeof body === 'string' ? body : Buffer.from(body as ArrayBuffer).toString('utf8');
		try {
			// An error answer is a sentence; a large body is not one.
			parsed = text.length <= 65536 ? JSON.parse(text) : undefined;
		} catch {
			parsed = undefined;
		}
	}
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const message = (parsed as Record<string, unknown>)[ERROR_FIELD];
		if (typeof message === 'string') {
			return capMessage(message);
		}
	}
	return capMessage(body);
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
	if (status >= 300 && status < 400) {
		const to = headers['location'] ?? headers['Location'] ?? '?';
		return (
			`Labelixa answered with a redirect (HTTP ${status}) to ${capMessage(String(to))}; ` +
			'redirects are not followed, check the base URL in the credential'
		);
	}
	const message = errorText(body);
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

export const DEFAULT_BASE_URL = 'https://api.labelixa.com';

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/**
 * Why an address must not receive the label text or the API key, or null
 * when it may.
 *
 * It must be https; plain http is accepted only for this machine (local
 * development). A URL with a user name or password is refused:
 * `https://api.labelixa.com@x.test` reads like the API but talks to another
 * host.
 */
export function baseUrlProblem(text: string): string | null {
	let u: URL | null = null;
	try {
		u = new URL(text);
	} catch {
		u = null;
	}
	if (!u) {
		return `The base URL "${text}" is not a valid URL`;
	}
	if (u.username || u.password) {
		return 'The base URL must not contain a user name or password';
	}
	if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOOPBACK.test(u.hostname))) {
		return 'The base URL must use https (plain http is allowed only for localhost)';
	}
	return null;
}

/**
 * Checks the credential's base URL and returns it without a trailing slash.
 * The label text and the API key go to this address (see baseUrlProblem).
 */
export function checkBaseUrl(raw: string | undefined): string {
	const text = (raw || DEFAULT_BASE_URL).trim();
	const problem = baseUrlProblem(text);
	if (problem) {
		throw new Error(problem);
	}
	// A loop, not /\/+$/ (polynomial backtracking on a long run of slashes).
	let out = text;
	while (out.endsWith('/')) out = out.slice(0, -1);
	return out;
}
