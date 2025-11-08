import React, { useState, useEffect } from "react";
import { Modal } from "../components/shared/Modal";
import { Button } from "../components/shared/Button";
import { DestinationType, Channel, ChannelFormData } from "../types";
import { TrashIcon, CodeIcon } from "../components/icons/Icon";
import { ScriptEditorModal } from "../components/shared/ScriptEditorModal";

interface ChannelFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChannelFormData) => void;
  initialData?: Channel | null;
}

interface DestinationFormData {
  name: string;
  type: DestinationType;
  endpoint: string;
  processingScript?: string;
}

const DEFAULT_DESTINATION: DestinationFormData = {
  name: "",
  type: DestinationType.HL7,
  endpoint: "",
  processingScript: "",
};

const ChannelForm: React.FC<ChannelFormProps> = ({ isOpen, onClose, onSubmit, initialData }) => {
  const [name, setName] = useState("");
  const [sourceEndpoint, setSourceEndpoint] = useState("");
  const [destinations, setDestinations] = useState<DestinationFormData[]>([{ ...DEFAULT_DESTINATION }]);
  const [processingScript, setProcessingScript] = useState("");
  const [responseScript, setResponseScript] = useState("");
  const [editingScriptForDestination, setEditingScriptForDestination] = useState<number | null>(null);

  const isEditing = !!initialData;

  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && initialData) {
      setName(initialData.name || "");
      setSourceEndpoint(initialData.source?.endpoint || "");
      setDestinations(
        initialData.destinations?.length
          ? initialData.destinations.map((d) => ({
              name: d.name || "",
              type: d.type || DestinationType.HL7,
              endpoint: d.endpoint || "",
              processingScript: d.processingScript || "",
            }))
          : [{ ...DEFAULT_DESTINATION }]
      );
      setProcessingScript(initialData.processingScript || "");
      setResponseScript(initialData.responseScript || "");
    } else {
      setName("");
      setSourceEndpoint("");
      setDestinations([{ ...DEFAULT_DESTINATION }]);
      setProcessingScript("");
      setResponseScript("");
    }
  }, [isOpen, initialData, isEditing]);

  const handleAddDestination = () => setDestinations((prev) => [...prev, { ...DEFAULT_DESTINATION }]);
  const handleRemoveDestination = (index: number) => setDestinations((prev) => prev.filter((_, i) => i !== index));

  const handleDestinationChange = (index: number, field: keyof DestinationFormData, value: string) => {
    setDestinations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleDestinationScriptSave = (script: string) => {
    if (editingScriptForDestination !== null) {
      handleDestinationChange(editingScriptForDestination, "processingScript", script);
      setEditingScriptForDestination(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      source: { type: "HTTP", endpoint: sourceEndpoint },
      destinations,
      processingScript,
      responseScript,
    });
    onClose();
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={isEditing ? "Edit Channel" : "Create New Channel"} keepMounted>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <Input label="Channel Name" value={name} onChange={setName} placeholder="e.g., Patient Admissions (ADT)" />

            <Section title="Source (HTTP)">
              <Input label="Source Endpoint" value={sourceEndpoint} onChange={setSourceEndpoint} placeholder="/api/adt" />
            </Section>

            <Section title="Channel Scripts (Optional)">
              <TextArea label="Processing Script (runs before destinations)" value={processingScript} onChange={setProcessingScript} help="JavaScript to transform the message before sending to any destination." />
              <TextArea label="Response Script" value={responseScript} onChange={setResponseScript} help="JavaScript to generate the HTTP response to the sender." />
            </Section>

            <Section title="Destinations">
              {destinations.map((dest, index) => (
                <div key={index} className="p-4 bg-slate-800/70 rounded-md mb-3 space-y-4 relative border border-slate-700">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Input label="Destination Name" value={dest.name} onChange={(v) => handleDestinationChange(index, "name", v)} placeholder="EMR HL7 Feed" />
                    <Select
                      label="Type"
                      value={dest.type}
                      options={[
                        { value: DestinationType.HL7, label: "HL7" },
                        { value: DestinationType.REST, label: "REST" },
                      ]}
                      onChange={(v) => handleDestinationChange(index, "type", v)}
                    />
                  </div>
                  <Input label="Endpoint" value={dest.endpoint} onChange={(v) => handleDestinationChange(index, "endpoint", v)} placeholder="emr.hospital.local:5000" />
                  <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination(index)}>
                    <CodeIcon /> {dest.processingScript ? "Edit Script" : "Add Script"}
                  </Button>
                  {destinations.length > 1 && (
                    <button type="button" onClick={() => handleRemoveDestination(index)} className="absolute top-2 right-2 p-1 text-slate-400 hover:text-red-400">
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={handleAddDestination}>
                Add Destination
              </Button>
            </Section>
          </div>

          <div className="bg-slate-900/50 px-6 py-4 flex justify-end gap-3 border-t border-slate-700 sticky bottom-0">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{isEditing ? "Save Changes" : "Create Channel"}</Button>
          </div>
        </form>
      </Modal>

      {editingScriptForDestination !== null && (
        <ScriptEditorModal
          isOpen={true}
          onClose={() => setEditingScriptForDestination(null)}
          onSave={handleDestinationScriptSave}
          initialScript={destinations[editingScriptForDestination]?.processingScript || ""}
          title={`Edit Script for: ${destinations[editingScriptForDestination]?.name || "New Destination"}`}
        />
      )}
    </>
  );
};

// small reusable inputs for cleaner code
const Input = ({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500" />
  </div>
);

const TextArea = ({ label, value, onChange, help }: { label: string; value: string; onChange: (v: string) => void; help: string }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-cyan-300 font-mono text-sm focus:ring-indigo-500 focus:border-indigo-500" />
    <p className="text-xs text-slate-500 mt-1">{help}</p>
  </div>
);

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white focus:ring-indigo-500 focus:border-indigo-500">
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-t border-slate-700 pt-4">
    <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
    <div className="space-y-4">{children}</div>
  </div>
);

export default React.memo(ChannelForm);
