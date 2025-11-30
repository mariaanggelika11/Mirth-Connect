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

  useEffect(() => {
    if (isOpen) setScript(initialScript);
  }, [isOpen, initialScript]);

  const type = title.toLowerCase().includes("template") ? "template" : title.toLowerCase().includes("response") ? "response" : "transformer";

  /* ===========================================================
     CENTRALIZED SCRIPT PROFILES
  ============================================================ */
  const SCRIPT_GUIDES = {
    transformer: {
      placeholder: `// Transformer Script
// Modify 'msg' before routing.
// Example:
msg.patientName = msg.patientName?.toUpperCase();
return msg;`,
      info: `Transformer receives 'msg' and MUST return 'msg'.`,
    },

    response: {
      placeholder: `// Response Script
// Modify the returned text/ACK.
// Example:
if (response.includes("OK")) {
  response = "SUCCESS";
}
return response;`,
      info: `Response script receives 'response' and MUST return 'response'.`,
    },

    template: {
      placeholder: `// Template Script
// MUST return FINAL outbound payload (object or HL7 string).
return {
  id: msg.id,
  name: msg.name,
  time: new Date().toISOString()
};

// HL7 Example:
// return \`MSH|^~\\\\&|App|Fac|Dest|Lab|\${Date.now()}||ORM^O01|MSGID|P|2.5\`;`,
      info: `Template builds the FINAL outbound message. MUST return object/string.`,
    },
  } as const;

  const CURRENT = SCRIPT_GUIDES[type];

  /* ===========================================================
     BUTTON INSERTIONS (PRESET SNIPPETS)
  ============================================================ */

  const INSERT_SNIPPETS = {
    transformer: `// Example Transformer
msg.processedAt = new Date().toISOString();
msg.source = "Channel";
return msg;`,

    response: `// Example Response Modifier
if (response.includes("OK")) {
  response = "ACK SUCCESS";
}
return response;`,

    templateJSON: `// JSON Template Example
return {
  patientId: msg.patientId,
  patientName: msg.patientName,
  timestamp: new Date().toISOString(),
  status: "READY"
};`,

    templateHL7: `// HL7 Template Example
return \`MSH|^~\\\\&|SendingApp|SendingFac|RecvApp|RecvFac|\${Date.now()}||ORM^O01|MSGID123|P|2.5
PID|1|\${msg.patientId}||\${msg.patientName}||\${msg.birthDate}\`;`,
  };

  /* ===========================================================
     HELPERS
  ============================================================ */

  function insertSnippet(code: string) {
    setScript((prev) => prev + "\n\n" + code);
  }

  function handleSave() {
    onSave(script);
  }

  /* ===========================================================
     RENDER
  ============================================================ */

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-6 space-y-3">
        {/* SNIPPET BUTTONS */}
        <div className="flex flex-wrap gap-2 mb-3">
          {type === "transformer" && (
            <Button variant="secondary" type="button" onClick={() => insertSnippet(INSERT_SNIPPETS.transformer)}>
              Insert Transformer Example
            </Button>
          )}

          {type === "response" && (
            <Button variant="secondary" type="button" onClick={() => insertSnippet(INSERT_SNIPPETS.response)}>
              Insert Response Example
            </Button>
          )}

          {type === "template" && (
            <>
              <Button variant="secondary" type="button" onClick={() => insertSnippet(INSERT_SNIPPETS.templateJSON)}>
                Insert JSON Template
              </Button>

              <Button variant="secondary" type="button" onClick={() => insertSnippet(INSERT_SNIPPETS.templateHL7)}>
                Insert HL7 Template
              </Button>
            </>
          )}
        </div>

        {/* TEXTAREA */}
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={CURRENT.placeholder}
          rows={15}
          spellCheck={false}
          className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2
                     text-cyan-300 font-mono text-sm"
        />

        {/* INFO BOX */}
        <div className="bg-slate-800 border border-slate-700 rounded-md p-3 text-xs text-slate-400">
          <p className="font-semibold text-slate-200 mb-1">{type.toUpperCase()} Script Info</p>
          <pre className="whitespace-pre-wrap">{CURRENT.info}</pre>
        </div>
      </div>

      <div className="bg-slate-800 px-6 py-4 flex justify-end gap-3">
        <Button variant="secondary" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave}>
          Save Script
        </Button>
      </div>
    </Modal>
  );
};
