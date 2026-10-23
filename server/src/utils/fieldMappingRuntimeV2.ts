/** Fixed JavaScript source for the existing QuickJS sandbox. Kept as text so browser
 * production minification cannot rename helpers or introduce module import aliases.
 * No host evaluation occurs; only canonical mappings include this bounded runtime.
 */
export const fieldMappingRuntimeV2 = String.raw`function validCalendarDate(value) {
    if (!/^\d{8}$/.test(value))
        return false;
    const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
function validHl7Timestamp(value) {
    const offsetHour = Number(value.slice(15, 17));
    const offsetMinute = Number(value.slice(17, 19));
    return (/^\d{14}(?:[+-]\d{4})?$/.test(value) &&
        validCalendarDate(value.slice(0, 8)) &&
        Number(value.slice(8, 10)) < 24 &&
        Number(value.slice(10, 12)) < 60 &&
        Number(value.slice(12, 14)) < 60 &&
        (value.length === 14 ||
            (offsetHour <= 14 && offsetMinute <= 59 && (offsetHour !== 14 || offsetMinute === 0))));
}
class MappingFailure extends Error {
    constructor(code, index = -1, field = '') {
        super(code);
        this.code = code;
        this.index = index;
        this.field = field;
    }
}
function mappingEmpty(value) {
    return value === undefined || value === null || value === '';
}
function mappingResolve(root, path) {
    let value = root;
    const header = root && typeof root === 'object' && root.MSH;
    const hl7 = !!root &&
        typeof root === 'object' &&
        Object.prototype.hasOwnProperty.call(root, 'MSH') &&
        header && typeof header === 'object' &&
        typeof header['1'] === 'string' && header['1'].length === 1 &&
        typeof header['2'] === 'string' && header['2'].length === 4;
    const normalized = hl7 ? path.replace(/^([A-Z0-9]{3})(?:\[(\d+)\])?-/, (_, segment, repetition) =>
        segment + (repetition === undefined ? '' : '.' + repetition) + '.') : path;
    const parts = normalized.split('.');
    for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        if (value !== null &&
            typeof value === 'object' &&
            Object.prototype.hasOwnProperty.call(value, part))
            value = value[part];
        else if (hl7 &&
            index >= 2 &&
            part === '1' &&
            ['string', 'number', 'boolean'].includes(typeof value))
            continue;
        else
            return undefined;
    }
    return value;
}
function mappingConvert(value, conversion, index) {
    if (!conversion || conversion === 'NONE')
        return value;
    if (conversion === 'TEXT')
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (conversion === 'NUMBER') {
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string' &&
            /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) &&
            Number.isFinite(Number(value)))
            return Number(value);
    }
    if (conversion === 'BOOLEAN') {
        if (typeof value === 'boolean')
            return value;
        if (value === 1 || value === 'true' || value === '1')
            return true;
        if (value === 0 || value === 'false' || value === '0')
            return false;
    }
    if (conversion === 'DATE_TO_HL7' &&
        typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        validCalendarDate(value.replace(/-/g, '')))
        return value.replace(/-/g, '');
    if (conversion === 'DATE_FROM_HL7' && typeof value === 'string' && validCalendarDate(value))
        return value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8);
    throw new MappingFailure('FIELD_MAPPING_CONVERSION', index);
}
function mappingSet(root, path, value, hl7) {
    const repeated = /^([A-Z0-9]{3})\[([0-9]+)\]\.(.*)$/.exec(path);
    let parts = path.split('.');
    if (repeated) {
        const existing = root[repeated[1]];
        if (!Array.isArray(existing))
            root[repeated[1]] = [];
        const segments = root[repeated[1]];
        const index = Number(repeated[2]);
        if (!segments[index])
            segments[index] = Object.create(null);
        root = segments[index];
        parts = repeated[3].split('.');
    }
    let current = root;
    for (let index = 0; index < parts.length - 1; index++) {
        const part = parts[index];
        if (!Object.prototype.hasOwnProperty.call(current, part))
            current[part] = !hl7 && /^\d+$/.test(parts[index + 1]) ? [] : Object.create(null);
        const next = current[part];
        if (!next || typeof next !== 'object')
            throw new MappingFailure('FIELD_MAPPING_TARGET');
        current = next;
    }
    current[parts[parts.length - 1]] = value;
}
function mappingScalar(value) {
    while (value && typeof value === 'object') {
        if (Array.isArray(value))
            value = value[0];
        else
            value = value['1'];
    }
    return value;
}
function mappedHl7Checks(output, config) {
    const scalar = (path) => mappingScalar(mappingResolve(output, path));
    const required = (path) => {
        const value = scalar(path);
        if (mappingEmpty(value) || (typeof value === 'string' && !value.trim()))
            throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, path);
        return value;
    };
    required('PID.3');
    required('PID.5');
    if (!validHl7Timestamp(String(required('MSH.7'))))
        throw new MappingFailure('HL7_PROFILE_DATE', -1, 'MSH.7');
    if (!String(required('MSH.10')).trim() || String(scalar('MSH.10')).length > 100)
        throw new MappingFailure('HL7_PROFILE_IDENTIFIER', -1, 'MSH.10');
    const pid = output.PID;
    const identifiers = Array.isArray(pid['3']) ? pid['3'] : [pid['3']];
    pid['3'] = identifiers.map((identifier) => {
        const record = identifier && typeof identifier === 'object' && !Array.isArray(identifier)
            ? { ...identifier }
            : { '1': identifier };
        if (mappingEmpty(mappingScalar(record['1'])))
            throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, 'PID.3');
        if (config.assigningAuthority && !record['4'])
            record['4'] = config.assigningAuthority;
        if (config.identifierType && !record['5'])
            record['5'] = config.identifierType;
        return record;
    });
    if (identifiers.length === 1)
        pid['3'] = pid['3'][0];
    if (!mappingEmpty(scalar('PID.7')) && !validCalendarDate(String(scalar('PID.7'))))
        throw new MappingFailure('HL7_PROFILE_DATE', -1, 'PID.7');
    if (!mappingEmpty(scalar('PID.8')) &&
        !['A', 'F', 'M', 'N', 'O', 'U'].includes(String(scalar('PID.8'))))
        throw new MappingFailure('HL7_PROFILE_CODE', -1, 'PID.8');
    if (!['I', 'O', 'E', 'P', 'R', 'B', 'C', 'N', 'U'].includes(String(required('PV1.2'))))
        throw new MappingFailure('HL7_PROFILE_CODE', -1, 'PV1.2');
    if (config.messageType.startsWith('ADT^')) {
        if (scalar('EVN.1') !== config.messageType.split('^')[1])
            throw new MappingFailure('HL7_PROFILE_CODE', -1, 'EVN.1');
        if (!validHl7Timestamp(String(required('EVN.2'))))
            throw new MappingFailure('HL7_PROFILE_DATE', -1, 'EVN.2');
    }
    else {
        required('OBR.4');
        if (config.messageType === 'ORM^O01') {
            const orc = output.ORC, obr = output.OBR;
            if (mappingEmpty(orc['2']) && !mappingEmpty(obr['2']))
                orc['2'] = obr['2'];
            if (mappingEmpty(obr['2']) && !mappingEmpty(orc['2']))
                obr['2'] = orc['2'];
            required('ORC.2');
            if (scalar('ORC.1') !== 'NW')
                throw new MappingFailure('HL7_PROFILE_CODE', -1, 'ORC.1');
            if (JSON.stringify(orc['2']) !== JSON.stringify(obr['2']))
                throw new MappingFailure('HL7_PROFILE_IDENTIFIER', -1, 'ORC.2');
        }
        else {
            if (mappingEmpty(scalar('OBR.2')) && mappingEmpty(scalar('OBR.3')))
                throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, 'OBR.3');
            const observations = Array.isArray(output.OBX) ? output.OBX : [output.OBX];
            if (!observations.length || observations.length > 100)
                throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, 'OBX.3');
            observations.forEach((observation, index) => {
                if (!observation || typeof observation !== 'object')
                    throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, 'OBX.3');
                const obs = observation;
                obs['1'] = String(index + 1);
                obs['2'] = obs['2'] || 'ST';
                obs['11'] = obs['11'] || 'F';
                for (const field of ['3', '5'])
                    if (mappingEmpty(mappingScalar(obs[field])))
                        throw new MappingFailure('HL7_PROFILE_REQUIRED', -1, 'OBX.' + field);
                if (!['ST', 'TX', 'NM'].includes(String(obs['2'])))
                    throw new MappingFailure('HL7_PROFILE_CODE', -1, 'OBX.2');
                if (!['F', 'P', 'C', 'X'].includes(String(obs['11'])))
                    throw new MappingFailure('HL7_PROFILE_CODE', -1, 'OBX.11');
                if (obs['2'] === 'NM' &&
                    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(mappingScalar(obs['5']))))
                    throw new MappingFailure('HL7_PROFILE_CODE', -1, 'OBX.5');
            });
        }
    }
}
function runV2Mapping(config, input, runtime) {
    if (typeof input === 'string') {
        try {
            input = JSON.parse(input);
        }
        catch {
            throw new MappingFailure('FIELD_MAPPING_INPUT_INVALID');
        }
    }
    if (!input || typeof input !== 'object')
        throw new MappingFailure('FIELD_MAPPING_INPUT_INVALID');
    const hl7 = config.hl7;
    let output = !hl7 && /^\d/.test(config.rows[0].target) ? [] : Object.create(null);
    if (hl7) {
        const timestamp = hl7.messageDateTime || runtime.timestamp;
        output = {
            MSH: {
                '1': '|',
                '2': '^~\\&',
                '3': hl7.sendingApplication,
                '4': hl7.sendingFacility,
                '5': hl7.receivingApplication,
                '6': hl7.receivingFacility,
                '7': timestamp,
                '9': {
                    '1': hl7.messageType.split('^')[0],
                    '2': hl7.messageType.split('^')[1],
                    '3': hl7.messageType.startsWith('ADT^') ? 'ADT_A01' : hl7.messageType.replace('^', '_'),
                },
                '10': hl7.messageControlId || runtime.controlId,
                '11': hl7.processingId,
                '12': hl7.version,
            },
        };
        if (hl7.messageType.startsWith('ADT^'))
            output.EVN = { '1': hl7.messageType.split('^')[1], '2': timestamp };
        output.PID = { '1': '1' };
        output.PV1 = { '1': '1', '2': hl7.patientClass };
        if (hl7.messageType === 'ORM^O01')
            output.ORC = { '1': 'NW' };
        if (!hl7.messageType.startsWith('ADT^'))
            output.OBR = { '1': '1' };
        if (hl7.messageType === 'ORU^R01')
            output.OBX = { '1': '1', '2': 'ST', '11': 'F' };
    }
    config.rows.forEach((row, index) => {
        let value = mappingResolve(input, row.source);
        if (mappingEmpty(value) && Object.prototype.hasOwnProperty.call(row, 'defaultValue'))
            value = row.defaultValue;
        if (mappingEmpty(value)) {
            if (row.required)
                throw new MappingFailure('FIELD_MAPPING_REQUIRED', index);
            if (value === undefined)
                return;
        }
        value = mappingConvert(value, row.conversion, index);
        mappingSet(output, row.target, value, !!hl7);
    });
    if (hl7)
        mappedHl7Checks(output, hl7);
    if (config.rootElement)
        return { [config.rootElement]: output };
    return output;
}
`;
