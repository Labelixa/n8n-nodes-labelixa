import type { ICredentialType, INodeProperties } from 'n8n-workflow';

/**
 * Labelixa credential: an optional `lbx_` key and the API address.
 *
 * The key is optional on purpose. The free tier needs no key (rate limited
 * per IP, no watermark), and a node that refused to run without one would
 * turn "try it" into "sign up first". The node adds the `X-API-Key` header
 * only when the field is filled, so an empty credential sends no header at
 * all rather than an empty one.
 *
 * No credential test: the API treats an unknown key as anonymous rather
 * than rejecting it, so a test request cannot tell a typo from a valid
 * key. Usage on the free plan showing up in the Labelixa panel is the
 * signal that a key is wrong.
 */
export class LabelixaApi implements ICredentialType {
	name = 'labelixaApi';

	displayName = 'Labelixa API';

	documentationUrl = 'https://labelixa.com/docs/api';

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
