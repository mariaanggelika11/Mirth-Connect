import hl7 from "simple-hl7";

/**
 *  Convert HL7 string → JSON (parsing basic segment & fields)
 */
export function hl7ToJson(raw: string): any {
  try {
    const parser = new hl7.Parser();
    const msg = parser.parse(raw); // parse HL7 raw string
    const segments = msg.segments.map((seg: any) => ({
      name: seg.name,
      fields: seg.fields.map((f: any) => f.value),
    }));

    const json: any = {};
    for (const seg of segments) {
      if (seg.name === "PID") {
        json.patientId = seg.fields[2] || "";
        json.name = seg.fields[4] || "";
        json.dob = seg.fields[6] || "";
        json.gender = seg.fields[7] || "";
      }
      if (seg.name === "MSH") {
        json.hl7type = seg.fields[7] || "";
      }
    }

    json._segments = segments; // simpan detail lengkap kalau dibutuhkan
    return json;
  } catch (err) {
    console.error(" Error parsing HL7:", err);
    return { error: "Invalid HL7", raw };
  }
}

/**
 *  Convert JSON → HL7 string
 */
export function jsonToHl7(data: any): string {
  try {
    const { patientId, name, dob, gender, hl7type } = data;

    // Buat message MSH + PID minimal
    const msg = new hl7.Message("MSH|^~\\&|MiniMirth|LOCAL|HIS|HOSP|" + new Date().toISOString() + "||" + (hl7type || "ADT^A01") + "|1234|P|2.3");
    msg.addSegment("PID", "1", "", patientId, "", name, "", dob, gender);

    return msg.toString();
  } catch (err) {
    console.error(" Error building HL7:", err);
    return "";
  }
}
