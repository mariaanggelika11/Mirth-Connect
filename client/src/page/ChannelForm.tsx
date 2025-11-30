import React, { useState, useEffect } from "react";
import { Modal } from "../components/shared/Modal";
import { Button } from "../components/shared/Button";
import { DestinationType, Channel, ChannelFormData, DataType } from "../types";
import { TrashIcon, CodeIcon } from "../components/icons/Icon";
import { ScriptEditorModal } from "../components/shared/ScriptEditorModal";

interface ChannelFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ChannelFormData) => Promise<void> | void;
  initialData?: Channel | null;
}

interface DestinationFormData {
  id?: number;
  channelId?: number;
  name: string;
  type: DestinationType;
  endpoint: string;
  outboundDataType: DataType;
  processingScript?: string;
  responseScript?: string;
  templateScript?: string;
}

const DEFAULT_DESTINATION: DestinationFormData = {
  name: "",
  type: DestinationType.HL7,
  endpoint: "",
  outboundDataType: DataType.HL7V2,
  processingScript: "",
  responseScript: "",
  templateScript: "",
};

const ChannelForm: React.FC<ChannelFormProps> = ({ isOpen, onClose, onSubmit, initialData }) => {
  const [name, setName] = useState("");
  const [sourceConnectorType, setSourceConnectorType] = useState<"HTTP" | "HL7">("HTTP");
  const [sourceInboundDataType, setSourceInboundDataType] = useState<DataType>(DataType.HL7V2);
  const [sourceTransformerScript, setSourceTransformerScript] = useState("");

  // NEW: state untuk modal source script
  const [editingSourceScript, setEditingSourceScript] = useState(false);

  const [autoEndpoint, setAutoEndpoint] = useState("");

  const [destinations, setDestinations] = useState<DestinationFormData[]>([{ ...DEFAULT_DESTINATION }]);

  const [editingScriptForDestination, setEditingScriptForDestination] = useState<{
    index: number;
    type: "processing" | "response" | "template";
  } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const isEditing = !!initialData;

  /* =========================================================
     LOAD INITIAL DATA
  ========================================================= */
  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && initialData) {
      setName(initialData.name || "");
      const srcType = initialData.source?.type;
      setSourceConnectorType(srcType === "HL7" ? "HL7" : "HTTP");
      setAutoEndpoint(initialData.source?.endpoint || "");
      setSourceInboundDataType(initialData.source?.inboundDataType || DataType.HL7V2);
      setSourceTransformerScript(initialData.processingScript || "");

      setDestinations(
        initialData.destinations?.length
          ? initialData.destinations.map((d) => ({
              id: d.id,
              channelId: d.channel_id,
              name: d.name || "",
              type: d.type || DestinationType.HL7,
              endpoint: d.endpoint || "",
              outboundDataType: d.outboundDataType || DataType.HL7V2,
              processingScript: d.processingScript || "",
              responseScript: d.responseScript || "",
              templateScript: d.templateScript || "",
            }))
          : [{ ...DEFAULT_DESTINATION }]
      );
    } else {
      setName("");
      setSourceConnectorType("HTTP");
      setAutoEndpoint("");
      setSourceInboundDataType(DataType.HL7V2);
      setSourceTransformerScript("");
      setDestinations([{ ...DEFAULT_DESTINATION }]);
      setErrors({});
      setSuccessMsg("");
    }
  }, [isOpen, initialData, isEditing]);

  /* =========================================================
     Add / Remove Destinations
  ========================================================= */
  const handleAddDestination = () => setDestinations((prev) => [...prev, { ...DEFAULT_DESTINATION }]);

  const handleRemoveDestination = (index: number) => {
    setDestinations((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDestinationChange = (index: number, field: keyof DestinationFormData, value: string) => {
    setDestinations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  /* =========================================================
     SAVE SCRIPT DESTINATION
  ========================================================= */
  const handleDestinationScriptSave = (script: string) => {
    if (editingScriptForDestination !== null) {
      const { index, type } = editingScriptForDestination;

      if (type === "processing") handleDestinationChange(index, "processingScript", script);
      else if (type === "response") handleDestinationChange(index, "responseScript", script);
      else if (type === "template") handleDestinationChange(index, "templateScript", script);

      setEditingScriptForDestination(null);
    }
  };

  /* =========================================================
     VALIDATION
  ========================================================= */
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) newErrors.name = "Channel name is required.";

    destinations.forEach((d, i) => {
      if (!d.name.trim()) newErrors[`dest_name_${i}`] = "Destination name is required.";
      if (!d.endpoint.trim()) newErrors[`dest_endpoint_${i}`] = "Endpoint is required.";
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /* =========================================================
     SUBMIT FORM
  ========================================================= */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
      setSubmitting(true);

      await onSubmit({
        name,
        source: {
          type: sourceConnectorType,
          inboundDataType: sourceInboundDataType,
        },
        processingScript: sourceTransformerScript,
        destinations,
      });

      setSuccessMsg(isEditing ? "Channel updated successfully" : "Channel created successfully");

      setTimeout(() => {
        setSubmitting(false);
        onClose();
      }, 600);
    } catch (err) {
      setErrors({ global: "Failed to save channel." });
      setSubmitting(false);
    }
  };

  /* =========================================================
     SELECT OPTIONS
  ========================================================= */
  const dataTypeOptions = [
    { value: DataType.HL7V2, label: "HL7 v2.x" },
    { value: DataType.XML, label: "XML" },
    { value: DataType.JSON, label: "JSON" },
    { value: DataType.TEXT, label: "Text" },
  ];

  const sourceConnectorOptions = [
    { value: "HTTP", label: "HTTP Receiver" },
    { value: "HL7", label: "HL7/MLLP Listener" },
  ];

  /* =========================================================
     UI
  ========================================================= */
  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Create / Edit Channel" keepMounted>
        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <Input label="Channel Name" value={name} onChange={setName} error={errors.name} />

            {/* SOURCE SECTION */}
            <Section title="Source Connector">
              <Select label="Source Connector Type" value={sourceConnectorType} onChange={(v) => setSourceConnectorType(v as "HTTP" | "HL7")} options={sourceConnectorOptions} />

              {isEditing && autoEndpoint && (
                <div>
                  <label className="block text-sm text-slate-300 mb-1">Auto Generated Endpoint</label>
                  <input value={autoEndpoint} readOnly className="w-full bg-slate-800 border border-slate-600 rounded-md px-3 py-2 text-slate-400" />
                  <p className="text-xs text-slate-500 mt-1">Generated automatically by backend</p>
                </div>
              )}

              <Select label="Inbound Data Type" value={sourceInboundDataType} onChange={(v) => setSourceInboundDataType(v as DataType)} options={dataTypeOptions} />
              {/* NEW BUTTON SOURCE SCRIPT */}
              <Button type="button" variant="secondary" onClick={() => setEditingSourceScript(true)}>
                <CodeIcon />
                {sourceTransformerScript ? "Edit Source Script" : "Add Source Script"}
              </Button>
            </Section>

            {/* DESTINATIONS */}
            <Section title="Destinations">
              {destinations.map((dest, index) => (
                <div key={index} className="p-4 bg-slate-800/70 rounded-md border border-slate-700 space-y-4 mb-4 relative">
                  <Input label="Destination Name" value={dest.name} onChange={(v) => handleDestinationChange(index, "name", v)} error={errors[`dest_name_${index}`]} />

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Select
                      label="Connector Type"
                      value={dest.type}
                      onChange={(v) => handleDestinationChange(index, "type", v === "REST" ? "REST" : v === "HL7" ? "HL7" : "MLLP")}
                      options={[
                        { value: "REST", label: "REST" },
                        { value: "HL7", label: "HL7 (MLLP)" },
                        { value: "MLLP", label: "MLLP (Raw HL7)" },
                      ]}
                    />

                    <Select
                      label="Outbound Data Type"
                      value={dest.outboundDataType}
                      onChange={(v) => {
                        const mapped = v === "HL7V2" ? DataType.HL7V2 : v === "XML" ? DataType.XML : v === "JSON" ? DataType.JSON : DataType.TEXT;

                        handleDestinationChange(index, "outboundDataType", mapped);
                      }}
                      options={dataTypeOptions}
                    />
                  </div>

                  <Input label="Endpoint" value={dest.endpoint} onChange={(v) => handleDestinationChange(index, "endpoint", v)} placeholder="example: localhost:5000" error={errors[`dest_endpoint_${index}`]} />

                  <div className="flex flex-col md:flex-row gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditingScriptForDestination({
                          index,
                          type: "processing",
                        })
                      }
                    >
                      <CodeIcon />
                      {dest.processingScript ? "Edit Transformer" : "Add Transformer"}
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditingScriptForDestination({
                          index,
                          type: "response",
                        })
                      }
                    >
                      <CodeIcon />
                      {dest.responseScript ? "Edit Response" : "Add Response"}
                    </Button>

                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setEditingScriptForDestination({
                          index,
                          type: "template",
                        })
                      }
                    >
                      <CodeIcon />
                      {dest.templateScript ? "Edit Template" : "Add Template"}
                    </Button>
                  </div>

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

            {errors.global && <p className="text-red-400 text-sm">{errors.global}</p>}
            {successMsg && <p className="text-green-400 text-sm">{successMsg}</p>}
          </div>

          <div className="px-6 py-4 flex justify-end gap-3 border-t border-slate-700 bg-slate-900/50">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save Channel"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* SOURCE SCRIPT MODAL */}
      {editingSourceScript && (
        <ScriptEditorModal
          isOpen={true}
          onClose={() => setEditingSourceScript(false)}
          onSave={(newScript) => {
            setSourceTransformerScript(newScript);
            setEditingSourceScript(false);
          }}
          initialScript={sourceTransformerScript}
          title="Edit Source Transformer Script"
        />
      )}

      {/* DESTINATION SCRIPT MODAL */}
      {editingScriptForDestination !== null && (
        <ScriptEditorModal
          isOpen={true}
          onClose={() => setEditingScriptForDestination(null)}
          onSave={handleDestinationScriptSave}
          initialScript={
            editingScriptForDestination.type === "processing"
              ? destinations[editingScriptForDestination.index]?.processingScript || ""
              : editingScriptForDestination.type === "response"
              ? destinations[editingScriptForDestination.index]?.responseScript || ""
              : destinations[editingScriptForDestination.index]?.templateScript || ""
          }
          title={`Edit ${editingScriptForDestination.type === "processing" ? "Transformer" : editingScriptForDestination.type === "response" ? "Response" : "Template"} Script`}
        />
      )}
    </>
  );
};

/* =========================================================
   SMALL INPUT COMPONENTS
========================================================= */
const Input = ({ label, value, onChange, placeholder, error }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`w-full bg-slate-700 border ${error ? "border-red-500" : "border-slate-600"} rounded-md px-3 py-2 text-white`} />
    {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
  </div>
);

const TextArea = ({ label, value, onChange, help }: { label: string; value: string; onChange: (v: string) => void; help: string }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} className="w-full bg-slate-900 border border-slate-600 rounded-md px-3 py-2 text-cyan-300 font-mono text-sm" />
    <p className="text-xs text-slate-500 mt-1">{help}</p>
  </div>
);

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
  <div>
    <label className="block text-sm font-medium text-slate-300 mb-1">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white">
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
