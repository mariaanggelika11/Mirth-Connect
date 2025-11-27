import hl7 from "simple-hl7";
/**
 * HL7 → JSON parser (manual, stable, mirip Mirth)
 * Support: MSH, PID, PV1, OBX (repeating), ORC, OBR, NK1, DG1
 */
export function hl7ToJson(raw: string): any {
  try {
    if (!raw || typeof raw !== "string") {
      throw new Error("HL7 payload must be a string");
    }

    if (!raw.includes("MSH|")) {
      throw new Error("HL7 missing MSH segment");
    }

    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const json: any = {};

    for (const line of lines) {
      const parts = line.split("|");
      const seg = parts[0];

      // MSH
      if (seg === "MSH") {
        const msgType = parts[8] || "";
        const msgEvent = msgType.includes("^") ? msgType.split("^")[1] : msgType;

        json.MSH = {
          sendingApplication: parts[2] || "",
          sendingFacility: parts[3] || "",
          receivingApplication: parts[4] || "",
          receivingFacility: parts[5] || "",
          timestamp: parts[6] || "",
          messageType: msgType,
          event: msgEvent || "",
        };
      }

      // PID
      if (seg === "PID") {
        const patientId = parts[3] || "";
        const name = parts[5] || "";
        const nameParts = name.split("^");
        const lastName = nameParts[0] || "";
        const firstName = nameParts[1] || "";

        json.PID = {
          id: patientId.split("^")[0] || "",
          lastName: lastName,
          firstName: firstName,
          dob: parts[7] || "",
          gender: parts[8] || "",
        };
      }

      // PV1
      if (seg === "PV1") {
        json.PV1 = {
          patientClass: parts[2] || "",
          assignedLocation: parts[3] || "",
          attendingDoctor: parts[7] || "",
          visitNumber: parts[19] || "",
        };
      }

      // OBX (array)
      if (seg === "OBX") {
        if (!json.OBX) json.OBX = [];

        const identifier = parts[3] || "";
        const idCode = identifier.includes("^") ? identifier.split("^")[0] : identifier;
        const description = identifier.includes("^") ? identifier.split("^")[1] : "";

        json.OBX.push({
          id: parts[1] || "",
          valueType: parts[2] || "",
          code: idCode,
          description: description,
          value: parts[5] || "",
          units: parts[6] || "",
        });
      }

      // ORC
      if (seg === "ORC") {
        json.ORC = {
          orderControl: parts[1] || "",
          placerOrderNumber: parts[2] || "",
        };
      }

      // OBR
      if (seg === "OBR") {
        json.OBR = {
          setId: parts[1] || "",
          placerOrderNumber: parts[2] || "",
          universalServiceId: parts[4] || "",
        };
      }

      // NK1
      if (seg === "NK1") {
        json.NK1 = {
          name: parts[2] || "",
          relationship: parts[3] || "",
        };
      }

      // DG1
      if (seg === "DG1") {
        json.DG1 = {
          setId: parts[1] || "",
          diagnosisCode: parts[3] || "",
          description: parts[4] || "",
        };
      }
    }

    return json;
  } catch (err: any) {
    return {
      success: false,
      error: "Failed to parse HL7",
      details: err.message,
    };
  }
}

/**
 * JSON → HL7 builder
 * Menghasilkan HL7 klinis stabil
 */
export function jsonToHl7(data: any): string {
  try {
    const msh = data.MSH || {};
    const pid = data.PID || {};

    const nameField = `${pid.lastName || ""}^${pid.firstName || ""}`;

    const mshSeg = `MSH|^~\\&|${msh.sendingApplication || ""}|${msh.sendingFacility || ""}|` + `${msh.receivingApplication || ""}|${msh.receivingFacility || ""}|${msh.timestamp || ""}` + `||ADT^${msh.event || "A01"}|MSG00001|P|2.5`;

    const pidSeg = `PID|1||${pid.id || ""}^^^Hospital^MR||${nameField}||${pid.dob || ""}|${pid.gender || ""}`;

    const result = [mshSeg, pidSeg];

    // OBX
    if (Array.isArray(data.OBX)) {
      for (const obx of data.OBX) {
        const code = `${obx.code || ""}^${obx.description || ""}`;
        result.push(`OBX|${obx.id || ""}|${obx.valueType || ""}|${code}||${obx.value || ""}|${obx.units || ""}|`);
      }
    }

    // PV1
    if (data.PV1) {
      const pv1 = data.PV1;
      result.push(`PV1|1|${pv1.patientClass || ""}|${pv1.assignedLocation || ""}|||${pv1.attendingDoctor || ""}|||||||||||${pv1.visitNumber || ""}`);
    }

    // ORC
    if (data.ORC) {
      const orc = data.ORC;
      result.push(`ORC|${orc.orderControl || ""}|${orc.placerOrderNumber || ""}`);
    }

    // OBR
    if (data.OBR) {
      const obr = data.OBR;
      result.push(`OBR|${obr.setId || ""}|${obr.placerOrderNumber || ""}|||${obr.universalServiceId || ""}`);
    }

    // NK1
    if (data.NK1) {
      const nk = data.NK1;
      result.push(`NK1|1|${nk.name || ""}|${nk.relationship || ""}`);
    }

    // DG1
    if (data.DG1) {
      const dg = data.DG1;
      result.push(`DG1|${dg.setId || ""}|ICD|${dg.diagnosisCode || ""}|${dg.description || ""}`);
    }

    return result.join("\r\n");
  } catch (err: any) {
    return "";
  }
}
