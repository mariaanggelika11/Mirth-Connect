import React, { useState, useEffect } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

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

  const SCRIPT_GUIDES = {
    transformer: {
      placeholder: `// Transformer Script\nreturn msg;`,
      info: `Transformer receives 'msg' and MUST return 'msg'.`,
    },
    response: {
      placeholder: `// Response Script\nreturn response;`,
      info: `Response script receives 'response' and MUST return 'response'.`,
    },
    template: {
      placeholder: `// Template Script\nreturn msg;`,
      info: `Template builds FINAL outbound payload.`,
    },
  } as const;

  const CURRENT = SCRIPT_GUIDES[type];

  function handleSave() {
    onSave(script);
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <textarea value={script} onChange={(e) => setScript(e.target.value)} placeholder={CURRENT.placeholder} rows={15} spellCheck={false} className="code-box" />

        <div className="card-bw" style={{ padding: 12, fontSize: 12 }}>
          <strong style={{ display: "block", marginBottom: 4 }}>{type.toUpperCase()} Script Info</strong>
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
        <Button onClick={handleSave}>Save Script</Button>
      </div>
    </Modal>
  );
};
