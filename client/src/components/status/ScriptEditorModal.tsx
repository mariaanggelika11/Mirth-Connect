import React, { useState, useEffect } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ConfirmationModal } from '../ui/ConfirmationModal';

export type ScriptType = 'transformer' | 'template' | 'response' | 'filter';

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
  const [confirmTemplate, setConfirmTemplate] = useState(false);

  useEffect(() => {
    if (isOpen) setScript(initialScript);
    setConfirmTemplate(false);
  }, [isOpen, initialScript, scriptType]);

  const SCRIPT_GUIDES = {
    filter: {
      placeholder: `// msg is the Source Processed Message, before destination transformation.\n// Return a boolean: true delivers; false skips only this destination.\nreturn msg.department === "LAB";`,
      info: 'Use msg from Source Processed Message. Return true to allow this destination or false to skip it. Input may be an object or a string, according to source processing. The script runs in the existing restricted sandbox.',
    },
    transformer: {
      placeholder: `// Transform msg and return the result.
return msg;`,
      info: 'Read incoming data from msg and return the transformed value. Use hl7ToJson(msg) when parsing an HL7 string. Scripts run in the restricted sandbox; test the result in Review & Test.',
    },

    template: {
      placeholder: `// Build the final outbound payload from msg.
return msg;`,
      info: 'Return the final payload after destination transformation and before format conversion. Existing HL7/JSON helpers remain available in the restricted sandbox.',
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
      info: 'Handle destination response.\nNever return msg.',
    },
  } as const;

  const CURRENT = SCRIPT_GUIDES[scriptType];

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={title} className="script-editor-dialog">
        <div className="script-editor-content">
          <label className="field script-code-field">
            <span>JavaScript</span>
            <textarea
              aria-label={title}
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={CURRENT.placeholder}
              rows={12}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="code-box"
            />
          </label>
          <details className="validation-help script-editor-help">
            <summary>Script help</summary>
            <p>{CURRENT.info}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (script.trim() && script !== CURRENT.placeholder) setConfirmTemplate(true);
                else setScript(CURRENT.placeholder);
              }}
            >
              Use template
            </Button>
          </details>
          <small className="muted">Save the channel afterward to keep these changes.</small>
        </div>
        <div className="script-editor-actions">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => onSave(script)}>
            Save Script
          </Button>
        </div>
      </Modal>
      <ConfirmationModal
        isOpen={isOpen && confirmTemplate}
        onClose={() => setConfirmTemplate(false)}
        onConfirm={() => {
          setScript(CURRENT.placeholder);
          setConfirmTemplate(false);
        }}
        title="Replace script with template?"
        message="This replaces the code in this editor. Save Script applies it to the form; Save Channel keeps the change."
        confirmLabel="Use template"
      />
    </>
  );
};
