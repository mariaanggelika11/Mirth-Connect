import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";

interface ScriptEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (script: string) => void;
  initialScript: string;
  title: string;
}

export const ScriptEditorModal: React.FC<ScriptEditorModalProps> = ({ isOpen, onClose, onSave, initialScript, title }) => {
  const [script, setScript] = useState(initialScript);

  // Reset saat modal dibuka
  useEffect(() => {
    if (isOpen) setScript(initialScript);
  }, [isOpen, initialScript]);

  const handleSave = () => onSave(script);

  // ============================================================
  // DETECT SCRIPT TYPE
  // ============================================================
  const isTransformer = title.toLowerCase().includes("transform");
  const isResponse = title.toLowerCase().includes("response");
  const isTemplate = title.toLowerCase().includes("template");

  // ============================================================
  // PLACEHOLDERS
  // ============================================================

  const transformerPlaceholder = `// Destination Transformer Script
// Modify msg before sending.
// Example:
msg.patientName = msg.patientName?.toUpperCase();
return msg;
`;

  const responsePlaceholder = `// Response Script (runs after destination reply)
// Use 'response' to modify the returned text/ACK.
// Example:
if (response.includes("OK")) {
  response = "YEY SUKSES";
}
return response;
`;

  // IMPORTANT:
  // Template must be JS that returns final payload !!
  // This matches backend executeTemplateScript()
  const templatePlaceholder = `// Template Script
// Build final outbound message here.
// MUST return string or object.
// Example (JSON):
return {
  patientId: msg.patientId,
  name: msg.name,
  timestamp: new Date().toISOString()
};

// Example (HL7 string):
// return \`MSH|^~\\\\&|Sending|Hospital|Recv|Lab|\${Date.now()}||ORM^O01|MSGID|P|2.5\`;
`;

  const placeholderText = isTemplate ? templatePlaceholder : isResponse ? responsePlaceholder : isTransformer ? transformerPlaceholder : "// Enter script here...";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-6">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={placeholderText}
          rows={15}
          className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-cyan-300 font-mono text-sm"
          spellCheck="false"
        />

        {!isTemplate && (
          <p className="text-xs text-slate-500 mt-2">
            Script receives <code className="bg-slate-700 px-1 rounded">msg</code> or <code className="bg-slate-700 px-1 rounded">response</code> depending on the type.
          </p>
        )}
      </div>

      <div className="bg-slate-800 px-6 py-4 flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Save Script
        </Button>
      </div>
    </Modal>
  );
};
