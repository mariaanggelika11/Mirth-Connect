/**
 * UNIVERSAL HL7 V2 PARSER
 * Menghasilkan struktur tree JSON mirip MIRTH
 *
 * Contoh akses:
 * msg['PID']['5']['2'] → First Name
 */

export function hl7ToJson(raw: string): any {
  const result: any = {};

  if (!raw || typeof raw !== "string") return result;

  const segments = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const seg of segments) {
    const fields = seg.split("|");
    const segName = fields[0];

    if (!result[segName]) {
      result[segName] = {};
    }

    for (let i = 1; i < fields.length; i++) {
      const fieldVal = fields[i];

      // Jika field punya komponen (^)
      if (fieldVal.includes("^")) {
        const components = fieldVal.split("^");

        result[segName][`${i}`] = {};

        components.forEach((comp, idx) => {
          result[segName][`${i}`][`${idx + 1}`] = comp;
        });
      } else {
        // Field sederhana
        result[segName][`${i}`] = fieldVal;
      }
    }
  }

  return result;
}

/**
 * UNIVERSAL JSON → HL7 V2 Builder
 * Mengambil JSON mirip Mirth → menjadi HL7 string
 */
export function jsonToHl7(obj: any): string {
  if (!obj || typeof obj !== "object") return "";

  const segments: string[] = [];

  for (const segName of Object.keys(obj)) {
    const seg = obj[segName];

    const fields: string[] = [];

    const maxFieldIndex = Math.max(...Object.keys(seg).map((x) => Number(x)));

    for (let i = 1; i <= maxFieldIndex; i++) {
      const fieldVal = seg[String(i)];

      if (typeof fieldVal === "object") {
        // Components → gabung ^
        const comps = Object.keys(fieldVal)
          .map((k) => fieldVal[k] ?? "")
          .join("^");

        fields.push(comps);
      } else {
        fields.push(fieldVal ?? "");
      }
    }

    segments.push(segName + "|" + fields.join("|"));
  }

  return segments.join("\r");
}
