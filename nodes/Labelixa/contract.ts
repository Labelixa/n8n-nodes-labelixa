/**
 * The API's wire vocabulary, and the English names the node outputs instead.
 *
 * Some JSON field names in Labelixa API answers are Turkish (`ozet`,
 * `mesaj`, `dil`, ...). They are the API's stable wire protocol: every
 * client reads them, so the server cannot rename them. That is why
 * non-English tokens appear below as string literals. This node renames
 * them once, after parsing, so a workflow reads `summary.total` rather than
 * `ozet.toplam`. A few enum-like values are Turkish code words too
 * (`risk.seviye: "dusuk"`); those are translated per field (VALUE_NAMES).
 *
 * Endpoints covered: /v1/diagnostics and /v1/{epl,tspl,cpcl}/diagnostics
 * (Validate), /v1/language-detect (Detect Language) and /v1/compatibility
 * (Check Printer Compatibility). Reference: https://labelixa.com/docs/api
 */

/** The field an error answer carries its message in: `{"hata": "..."}`. */
export const ERROR_FIELD = 'hata';

/** Wire key -> output key. A key not listed here passes through unchanged. */
export const FIELD_NAMES: Readonly<Record<string, string>> = Object.freeze({
	// Validate: the report.
	mesaj: 'message',
	ozet: 'summary',
	toplam: 'total',
	alanlar: 'fields',
	onizleme: 'preview',
	// Validate: a quick fix.
	baslik: 'title',
	baslik_key: 'title_key',
	yeni: 'replacement',
	// Validate: RFID blocks (^RF).
	islem: 'operation',
	bicim: 'format',
	banka: 'bank',
	veri: 'data',
	// Validate: the arguments a diagnostic's message was built from.
	komut: 'command',
	oneri: 'suggestion',
	parametre: 'parameter',
	deger: 'value',
	hane: 'digits',
	verilen: 'given',
	dogru: 'correct',
	beklenen: 'expected',
	gelen: 'actual',
	uzunluk: 'length',
	yol: 'path',
	genislik: 'label_width',
	yukseklik: 'label_height',
	bitis: 'end',
	gen: 'print_width',
	azami: 'maximum',
	desteklenen: 'supported_dpi',
	tip: 'type',
	// Detect Language.
	dil: 'language',
	guven: 'confidence',
	karma: 'mixed',
	puanlar: 'scores',
	kanitlar: 'evidence',
	kod: 'code',
	satir: 'line',
	// Check Printer Compatibility.
	uretici: 'manufacturer',
	kategori: 'category',
	dil_postur: 'language_support',
	tur: 'type',
	kaynak_url: 'source_url',
	dogrulama: 'verification',
	cihaz_seri: 'device_serial',
	not: 'note',
	seviye: 'level',
	gerekceler: 'reasons',
	boyut_kurali_var: 'has_size_rule',
	boyut_bulgulari: 'size_findings',
	onizleme_kapsami: 'preview_coverage',
	destekli: 'supported',
	kismi: 'partial',
	desteksiz: 'unsupported',
	yok_sayilan: 'ignored',
	bilinmiyor: 'unknown',
	sinir: 'limitation',
});

/**
 * Enum-like values the API sends as Turkish code words, per output field.
 * The key is the field's path in the node's output (English names, `[]` for
 * the items of an array). Only these fields are looked at, and only the
 * values listed: free text, rule codes such as ZPL1001, dates and any value
 * not listed pass through unchanged.
 */
export const VALUE_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
	// Check Printer Compatibility.
	'risk.level': { dusuk: 'low', orta: 'medium', yuksek: 'high' },
	'risk.reasons[]': {
		native: 'native',
		emulasyon: 'emulation',
		dil_yok: 'no_zpl_support',
		boyut_bulgusu: 'size_finding',
	},
	'model.category': { masaustu: 'desktop', endustriyel: 'industrial', mobil: 'mobile' },
	'language_support.type': { native: 'native', emulasyon: 'emulation' },
	limitation: { risk_analizi: 'risk_analysis' },
	// Detect Language: the signals behind the answer.
	'evidence[].code': {
		zpl_xa: 'zpl_xa',
		zpl_xz: 'zpl_xz',
		zpl_komut_yogunlugu: 'zpl_command_density',
		zpl_tilde: 'zpl_tilde',
		epl_metin_satiri: 'epl_text_line',
		epl_barkod_satiri: 'epl_barcode_line',
		epl_kontrol_satiri: 'epl_control_line',
		tspl_mm_boyut: 'tspl_mm_size',
		tspl_kelime: 'tspl_keyword',
		cpcl_baslik: 'cpcl_header',
		cpcl_kelime: 'cpcl_keyword',
	},
});

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Returns a copy of `value` with every known wire key renamed, at any depth
 * (objects inside arrays included), and the enum values of the fields in
 * VALUE_NAMES translated. Every other value is copied as it is. When the
 * English name is already taken in the same object, the wire key is kept, so
 * nothing is ever overwritten.
 */
export function englishFields(value: unknown, path = ''): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => englishFields(item, `${path}[]`));
	}
	if (typeof value === 'string') {
		const values = own(VALUE_NAMES, path) ? VALUE_NAMES[path] : undefined;
		return values && own(values, value) ? values[value] : value;
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	const source = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(source)) {
		const renamed = own(FIELD_NAMES, key) ? FIELD_NAMES[key] : key;
		const name = renamed !== key && (renamed in source || renamed in out) ? key : renamed;
		out[name] = englishFields(inner, path ? `${path}.${name}` : name);
	}
	return out;
}
