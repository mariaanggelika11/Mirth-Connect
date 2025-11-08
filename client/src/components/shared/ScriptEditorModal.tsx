import React, { useState } from "react";
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

  const handleSave = () => {
    onSave(script);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title}>
      <div className="p-6">
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={`// Enter your JavaScript code here.\n// Use the 'msg' variable to access the message object.\n// Return the modified message object.`}
          rows={15}
          className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-cyan-300 font-mono text-sm focus:ring-indigo-500 focus:border-indigo-500"
          spellCheck="false"
        ></textarea>
        <p className="text-xs text-slate-500 mt-2">
          The script will receive a message object (e.g., <code className="text-xs bg-slate-700 px-1 rounded">msg</code>). Modify it as needed and return it.
        </p>
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
