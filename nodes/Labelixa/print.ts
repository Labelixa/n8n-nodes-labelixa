/**
 * Print Label and Get Print Status: request planning and answer handling,
 * kept free of n8n plumbing so every rule here is testable on its own.
 *
 * Two facts shape this file:
 *
 * 1. Labelixa cannot confirm that a label physically came out of a printer.
 *    The furthest a job gets is `dispatched` (the bytes were delivered), and
 *    every answer carries `print_confirmed: false`. Nothing here turns an
 *    accepted or delivered job into a "printed" one.
 * 2. A repeated print request is an extra label on paper, not just an extra
 *    database row. Every Print Label request therefore carries an
 *    Idempotency-Key: when the same request is sent again with the same key,
 *    the server replays the first answer instead of queuing a second job.
 *    When the node cannot tell whether a job was queued (timeout, dropped
 *    connection, gateway error), it says so and never sends a new job by
 *    itself.
 *
 * Reference: https://labelixa.com/docs/api
 */

import {
	PRINT_REQUEST,
	PRINT_STAGE_SENTENCE_FIELD,
	PRINTER_STATUS_FIELD,
	englishPrintFields,
	englishPrinterStatus,
} from './contract';
import { errorText } from './plan';

/** The server accepts keys up to this length. */
export const MAX_KEY_LENGTH = 255;

export const PRINT_LANGUAGES = ['zpl', 'epl', 'tspl', 'cpcl', 'raw'] as const;

export interface PrintParams {
	target: 'device' | 'group';
	deviceId: string;
	printerGroup: string;
	content: string;
	copies: number;
	/** Empty: the device's own language. */
	language: string;
	labelCount: number;
	sourceJobId: string;
}

export interface JsonRequest {
	method: 'GET' | 'POST';
	path: string;
	headers: Record<string, string>;
	body: Record<string, unknown> | undefined;
}

/**
 * The Idempotency-Key for one item.
 *
 * Default: derived from the n8n execution id, the node's id and the item
 * index. n8n's "Retry On Fail" re-runs the node inside the same execution,
 * so a retried item sends the same key and cannot queue a second job. A new
 * execution (a new trigger, or re-running a failed execution) gets a new
 * key. A user-supplied key (for example an order number) overrides the
 * default and also protects across executions.
 */
export function idempotencyKey(
	override: string,
	executionId: string | undefined,
	nodeId: string,
	itemIndex: number,
): string {
	const own = (override ?? '').trim();
	const key = own || (executionId ? `n8n-${executionId}-${nodeId}-${itemIndex}` : '');
	if (!key) {
		throw new Error(
			'No n8n execution id is available to derive an Idempotency-Key; set the Idempotency Key option',
		);
	}
	if (key.length > MAX_KEY_LENGTH) {
		throw new Error(`The Idempotency-Key is longer than ${MAX_KEY_LENGTH} characters`);
	}
	// Visible ASCII only: the key travels in an HTTP header.
	if (!/^[\x21-\x7e]+$/.test(key)) {
		throw new Error('The Idempotency-Key may only contain visible ASCII characters (no spaces)');
	}
	return key;
}

function positiveInteger(name: string, value: number): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${name} must be a whole number of at least 1, got ${String(value)}`);
	}
	return value;
}

export function planPrint(p: PrintParams, key: string): JsonRequest {
	const f = PRINT_REQUEST;
	const body: Record<string, unknown> = {};
	if (p.target === 'group') {
		if (!p.printerGroup.trim()) throw new Error('Printer Group is required');
		body[f.printerGroup] = p.printerGroup.trim();
	} else {
		if (!p.deviceId.trim()) throw new Error('Device ID is required');
		body[f.deviceId] = p.deviceId.trim();
	}
	if (!p.content) throw new Error('Label Code is required');
	body[f.payload] = p.content;
	body[f.copies] = positiveInteger('Copies', p.copies);
	body[f.labelCount] = positiveInteger('Labels in Payload', p.labelCount);
	if (p.language) {
		if (!(PRINT_LANGUAGES as readonly string[]).includes(p.language)) {
			throw new Error(`Unknown printer language "${p.language}"`);
		}
		body[f.language] = p.language;
	}
	if (p.sourceJobId.trim()) body[f.sourceJobId] = p.sourceJobId.trim();
	return {
		method: 'POST',
		path: '/v1/print',
		headers: {
			// Named explicitly rather than left to n8n's defaults.
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'Idempotency-Key': key,
		},
		body,
	};
}

export function planPrintStatus(jobId: string): JsonRequest {
	const id = (jobId ?? '').trim();
	if (!id) throw new Error('Job ID is required');
	return {
		method: 'GET',
		path: `/v1/print/jobs/${encodeURIComponent(id)}`,
		headers: { Accept: 'application/json' },
		body: undefined,
	};
}

// ---- failures ---------------------------------------------------------------

/**
 * `not_queued`: the server answered and no job exists for this request.
 * `unknown`: a job may or may not exist; re-send with the same key, never
 * as a new job.
 */
export type Outcome = 'not_queued' | 'unknown' | 'not_applicable';

export interface FailureInfo {
	message: string;
	httpStatus: number | null;
	/** Whether sending the same request again later can succeed. */
	retryable: boolean;
	retryAfterSeconds: number | null;
	outcome: Outcome;
	idempotencyKey: string | null;
}

/** The fields an n8n item gets for a failure when Continue On Fail is on. */
export function failureJson(info: FailureInfo): Record<string, unknown> {
	return {
		error: info.message,
		http_status: info.httpStatus,
		retryable: info.retryable,
		retry_after_seconds: info.retryAfterSeconds,
		outcome: info.outcome,
		idempotency_key: info.idempotencyKey,
		print_confirmed: false,
	};
}

/**
 * A 2xx answer to Print Label whose body cannot be read: the job WAS
 * accepted, only the answer is lost.
 */
export function describeUnreadableAcceptance(status: number, body: unknown, key: string): FailureInfo {
	return {
		message:
			`Labelixa accepted the print request (HTTP ${status}) but its answer could not be read: ` +
			`${errorText(body)}. Do not send it as a new job. ${SAME_KEY(key)}`,
		httpStatus: status,
		retryable: true,
		retryAfterSeconds: null,
		outcome: 'unknown',
		idempotencyKey: key,
	};
}

function header(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
	const want = name.toLowerCase();
	for (const [k, v] of Object.entries(headers ?? {})) {
		if (k.toLowerCase() === want && v !== undefined) {
			return Array.isArray(v) ? v[0] : String(v);
		}
	}
	return undefined;
}

/** Retry-After in seconds (delta form, or an HTTP date); null if absent. */
export function retryAfterSeconds(
	headers: Record<string, string | string[] | undefined>,
	now = Date.now(),
): number | null {
	const raw = header(headers, 'retry-after');
	if (raw === undefined || raw.trim() === '') return null;
	if (/^\d+$/.test(raw.trim())) return Number(raw.trim());
	const at = Date.parse(raw);
	return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

const SAME_KEY = (key: string) =>
	`Sending the same request again with the same Idempotency-Key (${key}) is safe: ` +
	'the server returns the first answer instead of queuing a second job';

/** A non-2xx answer to Print Label, as one actionable sentence. */
export function describePrintFailure(
	status: number,
	body: unknown,
	headers: Record<string, string | string[] | undefined>,
	key: string,
): FailureInfo {
	const text = errorText(body);
	const wait = retryAfterSeconds(headers);
	const action = header(headers, 'x-quota-action');
	const base = { httpStatus: status, retryAfterSeconds: wait, idempotencyKey: key };
	if (status >= 300 && status < 400) {
		return {
			...base,
			message:
				`Labelixa answered with a redirect (HTTP ${status}); redirects are not followed, ` +
				'check the base URL in the credential. No job was queued',
			retryable: false,
			outcome: 'not_queued',
		};
	}
	if (status === 402) {
		return {
			...base,
			message:
				`Printing is not available on the current plan or the free print allowance is used up (HTTP 402): ${text}. ` +
				'No job was queued and the node does not retry' +
				(action ? ` (suggested action: ${action})` : ''),
			retryable: false,
			outcome: 'not_queued',
		};
	}
	if (status === 429) {
		const after = wait ?? 60;
		return {
			...base,
			retryAfterSeconds: after,
			message:
				`Labelixa is limiting print requests or the print queue is full (HTTP 429): ${text}. ` +
				`No job was queued. Retry after ${after} s. ${SAME_KEY(key)}`,
			retryable: true,
			outcome: 'not_queued',
		};
	}
	if (status === 409) {
		const after = wait ?? 2;
		return {
			...base,
			retryAfterSeconds: after,
			message:
				`A request with the same Idempotency-Key is still being processed (HTTP 409): ${text}. ` +
				`Retry after ${after} s with the same key; do not send it as a new job`,
			retryable: true,
			outcome: 'unknown',
		};
	}
	if (status === 422) {
		return {
			...base,
			message:
				`Labelixa rejected the print request (HTTP 422): ${text}. ` +
				'If the Idempotency-Key was already used for a different print request, a new job needs a new key',
			retryable: false,
			outcome: 'not_queued',
		};
	}
	if (status >= 500) {
		return {
			...base,
			message:
				`Labelixa answered HTTP ${status}: ${text}. Whether the job was queued is not known. ` +
				`${SAME_KEY(key)}. Do not send it as a new job`,
			retryable: true,
			outcome: 'unknown',
		};
	}
	const hint =
		status === 400
			? 'Fix the request; no job was queued'
			: status === 401
				? 'Check the API key in the credential; no job was queued'
				: status === 403
					? 'The key or plan may not use printing; no job was queued'
					: status === 404
						? 'Printing may not be enabled for this account, or the device or group does not exist; no job was queued'
						: 'No job was queued';
	return {
		...base,
		message: `Labelixa rejected the print request (HTTP ${status}): ${text}. ${hint}`,
		retryable: false,
		outcome: 'not_queued',
	};
}

/** Whether a transport error is a timeout (wording only; the rule is the same). */
export function isTimeout(error: unknown): boolean {
	const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
	const code = String(e?.code ?? e?.cause?.code ?? '');
	return (
		code === 'ECONNABORTED' ||
		code === 'ETIMEDOUT' ||
		code === 'ESOCKETTIMEDOUT' ||
		/time(d)?\s*out/i.test(String(e?.message ?? ''))
	);
}

/**
 * No HTTP answer at all (timeout, reset, DNS). The request may have reached
 * the server and queued a job, so this is never "failed, print again".
 */
export function describeTransportFailure(error: unknown, key: string, timeoutSeconds: number): FailureInfo {
	const what = isTimeout(error)
		? `No answer from Labelixa within ${timeoutSeconds} s`
		: `The connection to Labelixa failed (${error instanceof Error ? error.message : String(error)})`;
	return {
		message:
			`${what}. The job may or may not have been queued, so do not send it as a new job. ` +
			`${SAME_KEY(key)}; its answer carries the job_id to check with Get Print Status`,
		httpStatus: null,
		retryable: true,
		retryAfterSeconds: null,
		outcome: 'unknown',
		idempotencyKey: key,
	};
}

/** A non-200 answer to Get Print Status. Reading a status changes nothing. */
export function describeStatusFailure(
	status: number,
	body: unknown,
	headers: Record<string, string | string[] | undefined>,
): FailureInfo {
	const text = errorText(body);
	const wait = retryAfterSeconds(headers);
	let message = `Labelixa answered HTTP ${status}: ${text}`;
	if (status === 404) {
		message += '. The job does not exist or belongs to another account';
	} else if (status === 429 || status === 402) {
		message += `. Retry after ${wait ?? 60} s`;
	}
	return {
		message,
		httpStatus: status,
		retryable: status === 429 || status >= 500,
		retryAfterSeconds: status === 429 || status === 402 ? (wait ?? 60) : wait,
		outcome: 'not_applicable',
		idempotencyKey: null,
	};
}

// ---- answers ----------------------------------------------------------------

/** What each job status means, stated without claiming a printed label. */
export const STATUS_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
	queued: 'Accepted and waiting; no agent has taken the job yet.',
	dispatching: 'An agent has taken the job and is handing it to the printer.',
	dispatched:
		'The bytes were delivered to the printer. This does not confirm that a label physically printed.',
	failed:
		'Delivery failed. Check stage and copies_sent before sending it again: re-sending a partly delivered job prints those copies twice.',
	cancelled: 'The job was cancelled and will not be delivered.',
	uncertain:
		'The job reached the agent but no result came back, so whether anything reached the printer is not known. ' +
		'It is never retried automatically. Check the printer; if the label is missing, print it as a new job with a new Idempotency-Key.',
});

/** Statuses that need a person or a workflow branch to look at them. */
export const ATTENTION_STATUSES: readonly string[] = ['failed', 'uncertain'];

/** Statuses after which nothing changes any more. */
export const FINAL_STATUSES: readonly string[] = ['dispatched', 'failed', 'cancelled'];

const REACHED_PRINTER_STAGES = ['submitted_to_os', 'submitted_to_printer'];

/** One English sentence: how far the job got, before anyone checks the paper. */
export function stageSummary(status: string, stage: unknown, copiesSent: unknown, copies: unknown): string {
	const s = typeof stage === 'string' ? stage : '';
	const sent = typeof copiesSent === 'number' ? copiesSent : -1;
	const total = typeof copies === 'number' ? copies : 0;
	if (!s) {
		return status === 'uncertain'
			? 'The job reached the agent but no result came back; whether anything reached the printer is not known.'
			: 'The agent did not report a stage for this job; whether anything reached the printer is not known.';
	}
	if (!REACHED_PRINTER_STAGES.includes(s)) {
		return 'No bytes were sent to the printer.';
	}
	const where = s === 'submitted_to_os' ? 'the operating system print queue' : 'the printer';
	if (sent >= 0 && sent < total) {
		return `${sent} of ${total} copies were handed to ${where}; re-sending the job as it is prints those copies a second time.`;
	}
	return `The bytes were handed to ${where}. This is not a print confirmation.`;
}

/** Print Label's 202 answer, in English, with the key that produced it. */
export function printOutput(
	body: Record<string, unknown>,
	key: string,
	replayed: boolean,
): Record<string, unknown> {
	const out = englishPrintFields(body);
	out.print_confirmed = false;
	out.idempotency_key = key;
	out.replayed = replayed;
	return out;
}

/** Get Print Status's answer, in English, with what the status means. */
export function statusOutput(body: Record<string, unknown>): Record<string, unknown> {
	const source = { ...body };
	delete source[PRINT_STAGE_SENTENCE_FIELD];
	const printer = source[PRINTER_STATUS_FIELD];
	delete source[PRINTER_STATUS_FIELD];
	const out = englishPrintFields(source);
	const status = String(out.status ?? '');
	out.stage_summary = stageSummary(status, out.stage, out.copies_sent, out.copies);
	out.printer_status = englishPrinterStatus(printer);
	out.status_meaning = STATUS_MEANINGS[status] ?? `Status "${status}" is not known to this node version.`;
	out.final = FINAL_STATUSES.includes(status);
	out.needs_attention = ATTENTION_STATUSES.includes(status);
	// The API always sends false; the node never says anything else.
	out.print_confirmed = false;
	return out;
}
