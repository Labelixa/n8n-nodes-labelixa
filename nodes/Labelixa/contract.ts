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
 * (Validate), /v1/language-detect (Detect Language), /v1/compatibility
 * (Check Printer Compatibility), and POST /v1/print plus
 * GET /v1/print/jobs/{id} (Print Label, Get Print Status; see the PRINT_*
 * tables at the end). Reference: https://labelixa.com/docs/api
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

// ---- Printing: POST /v1/print and GET /v1/print/jobs/{id} -----------------

/**
 * Request body field names of POST /v1/print. `yuk` is the payload (the raw
 * label bytes, carried verbatim; `zpl` is its older alias and is not sent),
 * `dil` the printer language, `kopya` the copy count, `etiket_sayisi` the
 * number of labels in the payload and `kaynak_is_id` a render job the
 * payload came from.
 */
export const PRINT_REQUEST = Object.freeze({
	deviceId: 'device_id',
	printerGroup: 'printer_group',
	payload: 'yuk',
	language: 'dil',
	copies: 'kopya',
	labelCount: 'etiket_sayisi',
	sourceJobId: 'kaynak_is_id',
});

/**
 * Wire key -> output key for the two print answers. Kept apart from
 * FIELD_NAMES on purpose: some of these wire words mean something else in
 * other answers (`etiket` is a label count here and an evidence tag inside
 * the printer status, which the PRINTER_* tables handle). The English names
 * are the ones the Labelixa MCP server uses for the same fields.
 */
export const PRINT_FIELD_NAMES: Readonly<Record<string, string>> = Object.freeze({
	etiket: 'label_count',
	ucretlendi: 'charged',
	dil: 'language',
	uyari: 'warning',
	uyari_kodu: 'warning_code',
	sablon_id: 'template_id',
	etiket_id: 'label_id',
	cihaz_eslenmis: 'device_mapped',
	basim_onaylandi: 'print_confirmed',
	agent_son_gorulme: 'agent_last_seen',
	agent_son_gorulme_sn_once: 'agent_last_seen_seconds_ago',
	not: 'note',
	kopya: 'copies',
	etiket_sayisi: 'labels_per_copy',
	kaynak_is_id: 'source_job_id',
	zpl_ozeti: 'payload_hash',
	hata_tipi: 'error_type',
	asama: 'stage',
	gonderilen_kopya: 'copies_sent',
	yaziciya_giden_var_mi: 'reached_printer',
});

/**
 * Status answer fields the node does not pass on as they are:
 * `asama_ozeti` is a server sentence that is not in English (the node writes
 * its own `stage_summary` from `stage`, `copies_sent` and `copies`), and
 * `yazici_durumu` is the printer's own report, mapped by englishPrinterStatus.
 */
export const PRINT_STAGE_SENTENCE_FIELD = 'asama_ozeti';
export const PRINTER_STATUS_FIELD = 'yazici_durumu';

/** The printer status report (Zebra ~HS / ~HQES), field by field. */
export const PRINTER_STATUS_FIELDS = Object.freeze({
	health: 'saglik',
	basis: 'etiket',
	flags: 'bayraklar',
	attempt: 'deneme',
	finished: 'bitti_cikarimi',
	value: 'deger',
});

export const PRINTER_HEALTH: Readonly<Record<string, string>> = Object.freeze({
	hazir: 'ready',
	engel: 'blocked',
	bilinmiyor: 'unknown',
});

/** Whether a statement was reported by the printer or inferred from it. */
export const PRINTER_BASIS: Readonly<Record<string, string>> = Object.freeze({
	KANIT: 'reported',
	CIKARIM: 'inferred',
});

export const PRINTER_FLAGS: Readonly<Record<string, string>> = Object.freeze({
	kagit_bitti: 'media_out',
	duraklatildi: 'paused',
	tampon_dolu: 'buffer_full',
	tanilama_modu: 'diagnostic_mode',
	kismi_format: 'partial_format',
	bozuk_ram: 'corrupt_ram',
	sicaklik_alti: 'under_temperature',
	sicaklik_ustu: 'over_temperature',
	kafa_acik: 'head_open',
	serit_bitti: 'ribbon_out',
	etiket_bekliyor: 'label_waiting',
	hqes_hata: 'printer_error',
});

/**
 * Returns a copy of a print answer (top level only; both answers are flat)
 * with every known wire key renamed. As in englishFields, an English name
 * already present is never overwritten.
 */
export function englishPrintFields(value: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) {
		const renamed = own(PRINT_FIELD_NAMES, key) ? PRINT_FIELD_NAMES[key] : key;
		const name = renamed !== key && (renamed in value || renamed in out) ? key : renamed;
		out[name] = inner;
	}
	return out;
}

const mapValue = (table: Readonly<Record<string, string>>, v: unknown): unknown =>
	typeof v === 'string' && own(table, v) ? table[v] : v;

/**
 * The printer's own report in English: `health` (ready, blocked, unknown),
 * `basis` (reported or inferred), `flags`, `attempt` and
 * `finished_inference` ({ value, basis }; always an inference, never a print
 * confirmation). The server's free-text reasons are not passed on. A missing
 * report stays null (the printer was not asked).
 */
export function englishPrinterStatus(value: unknown): unknown {
	if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
		return value ?? null;
	}
	const src = value as Record<string, unknown>;
	const f = PRINTER_STATUS_FIELDS;
	const out: Record<string, unknown> = {
		health: mapValue(PRINTER_HEALTH, src[f.health]) ?? null,
		basis: mapValue(PRINTER_BASIS, src[f.basis]) ?? null,
		flags: Array.isArray(src[f.flags])
			? (src[f.flags] as unknown[]).map((x) => mapValue(PRINTER_FLAGS, x))
			: [],
		attempt: src[f.attempt] ?? null,
		finished_inference: null,
	};
	const finished = src[f.finished];
	if (finished && typeof finished === 'object' && !Array.isArray(finished)) {
		const fin = finished as Record<string, unknown>;
		out.finished_inference = {
			value: fin[f.value] ?? null,
			basis: mapValue(PRINTER_BASIS, fin[f.basis]) ?? null,
		};
	}
	return out;
}
