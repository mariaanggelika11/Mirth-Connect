import React, { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export type ScriptType = "transformer" | "template" | "response";

interface ScriptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (script: string) => void;
  initialScript: string;
  title: string;
  scriptType: ScriptType;
}

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialScript,
  title,
  scriptType,
}) => {
  const [script, setScript] = useState(initialScript);

  useEffect(() => {
    if (isOpen) setScript(initialScript);
  }, [isOpen, initialScript]);

  const SCRIPT_GUIDES = {
    transformer: {
      placeholder: `// TRANSFORMER SCRIPT
// HL7 -> JSON or JSON -> JSON
// MUST return msg

var json;

// If input is HL7
if (typeof msg === "string" && msg.startsWith("MSH|")) {
  json = hl7ToJson(msg);
} 
// If input is already JSON
else {
  json = msg;
}

msg = json;

return msg;`,
      info: "Convert HL7 to JSON or pass-through JSON.\nAlways return msg.",
    },

    template: {
      placeholder: `// TEMPLATE SCRIPT
// Build FINAL outbound payload
// MUST return msg

var json;

// Convert HL7 to JSON if needed
if (typeof msg === "string" && msg.trim().startsWith("MSH|")) {
  json = hl7ToJson(msg);
} else {
  json = msg;
}

// Final payload
msg = {
  firstName: json["PID"]?.["5"]?.["2"] || json.firstName,
  lastName:  json["PID"]?.["5"]?.["1"] || json.lastName,
  email:     json["PID"]?.["13"]?.["4"] || json.email,
  sendTime:  new Date().toISOString(),
  source:    "ENGINE-HL7"
};

return msg;`,
      info: "Build final payload for destination.\nHL7 or JSON supported.",
    },

    response: {
      placeholder: `// RESPONSE SCRIPT
// MUST return response

const parsed = JSON.parse(response);

if (parsed.status === "OK") {
  response = "DATA SENT SUCCESSFULLY";
} else {
  response = "DATA DELIVERY FAILED";
}

return response;`,
      info: "Handle destination response.\nNever return msg.",
    },
  } as const;

  const CURRENT = SCRIPT_GUIDES[scriptType];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div
        style={{
          padding: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={CURRENT.placeholder}
          rows={16}
          spellCheck={false}
          className="code-box"
        />

        <div className="card-bw" style={{ padding: 12, fontSize: 12 }}>
          <strong style={{ display: "block", marginBottom: 4 }}>
            {scriptType.toUpperCase()} GUIDE
          </strong>
          <pre style={{ whiteSpace: "pre-wrap" }}>{CURRENT.info}</pre>
        </div>
      </div>

      <div
        style={{
          padding: 16,
          display: "flex",
          justifyContent: "flex-end",
          gap: 12,
          borderTop: "1px solid var(--border-main)",
          background: "var(--bg-soft)",
        }}
      >
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSave(script)}>Save Script</Button>
      </div>
    </Modal>
  );
};
