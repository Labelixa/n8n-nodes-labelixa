import type {
	IAuthenticate,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

import { baseUrlProblem } from '../nodes/Labelixa/plan';

/**
 * Labelixa credential: an optional `lbx_` key and the API address.
 *
 * The key is optional on purpose. The free tier needs no key (rate limited
 * per IP, no watermark), and a node that refused to run without one would
 * turn "try it" into "sign up first". `authenticate` adds the `X-API-Key`
 * header only when the field is filled, so an empty credential sends no
 * header at all rather than an empty one.
 *
 * The credential test calls GET /v1/capabilities with the key: the API
 * rejects an unknown key with 401, serves a valid key with 200, and treats
 * a request without a key as anonymous (200) — so an empty credential also
 * passes, which is the free tier working as designed.
 */
export class LabelixaApi implements ICredentialType {
	name = 'labelixaApi';

	displayName = 'Labelixa API';

	icon: Icon = 'file:../nodes/Labelixa/labelixa.svg';

	documentationUrl = 'https://labelixa.com/docs/api';

	/**
	 * Adds the key to a request: only when one is set, and only towards an
	 * address the node itself accepts (https, or plain http to localhost) —
	 * the key is never sent in the clear to another host.
	 */
	authenticate: IAuthenticate = async (credentials, requestOptions) => {
		const apiKey = String(credentials.apiKey ?? '').trim();
		const url = String(requestOptions.url ?? '');
		const target = /^[a-z][a-z0-9+.-]*:/i.test(url)
			? url
			: String(requestOptions.baseURL ?? '') + url;
		if (!apiKey || baseUrlProblem(target) !== null) {
			return requestOptions;
		}
		return {
			...requestOptions,
			headers: { ...requestOptions.headers, 'X-API-Key': apiKey },
		};
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/capabilities',
			// Same rule as the node: a redirect would carry X-API-Key along.
			disableFollowRedirect: true,
		},
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'An lbx_ key from the Labelixa panel. Leave empty for the free tier (rate limited per IP, no watermark).',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.labelixa.com',
			description:
				'The hosted API, or your own instance for an on-premise deployment. Must be https (plain http only for localhost).',
		},
	];
}
