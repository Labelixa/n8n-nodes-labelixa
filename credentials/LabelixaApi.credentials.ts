import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Labelixa credential: an optional `lbx_` key and the API address.
 *
 * The key is optional on purpose. The free tier needs no key (rate limited
 * per IP, no watermark), and a node that refused to run without one would
 * turn "try it" into "sign up first". The node adds the `X-API-Key` header
 * only when the field is filled, so an empty credential sends no header at
 * all rather than an empty one.
 *
 * The credential test calls GET /v1/capabilities with the key: the API
 * rejects an unknown key with 401, serves a valid key with 200, and treats
 * an empty header as anonymous (200) — so an empty credential also passes,
 * which is the free tier working as designed.
 */
export class LabelixaApi implements ICredentialType {
	name = 'labelixaApi';

	displayName = 'Labelixa API';

	documentationUrl = 'https://labelixa.com/docs/api';

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/v1/capabilities',
			headers: { 'X-API-Key': '={{$credentials.apiKey}}' },
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
			description: 'The hosted API, or your own instance for an on-premise deployment',
		},
	];
}
