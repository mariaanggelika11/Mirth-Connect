import React, { useState, useEffect } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { DestinationType, Channel, ChannelFormData, DataType } from "../../types";
import { TrashIcon, CodeIcon } from "../../components/icons/Icon";
import { ScriptEditorModal } from "../../components/status/ScriptEditorModal";

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

  const handleDestinationScriptSave = (script: string) => {
    if (!editingScriptForDestination) return;
    const { index, type } = editingScriptForDestination;

    if (type === "processing") handleDestinationChange(index, "processingScript", script);
    if (type === "response") handleDestinationChange(index, "responseScript", script);
    if (type === "template") handleDestinationChange(index, "templateScript", script);

    setEditingScriptForDestination(null);
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Channel name is required.";

    destinations.forEach((d, i) => {
      if (!d.name.trim()) newErrors[`dest_name_${i}`] = "Destination name is required.";
      if (!d.endpoint.trim()) newErrors[`dest_endpoint_${i}`] = "Endpoint is required.";
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

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
    } catch {
      setErrors({ global: "Failed to save channel." });
      setSubmitting(false);
    }
  };

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

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Create / Edit Channel" keepMounted>
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <Input label="Channel Name" value={name} onChange={setName} error={errors.name} />

          <Section title="Source Connector">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select label="Source Connector Type" value={sourceConnectorType} onChange={(v: string) => setSourceConnectorType(v as "HTTP" | "HL7")} options={sourceConnectorOptions} />
              <Select label="Inbound Data Type" value={sourceInboundDataType} onChange={(v: string) => setSourceInboundDataType(v as DataType)} options={dataTypeOptions} />
            </div>

            <Button type="button" variant="secondary" onClick={() => setEditingSourceScript(true)}>
              <CodeIcon /> {sourceTransformerScript ? "Edit Source Script" : "Add Source Script"}
            </Button>
          </Section>

          <Section title="Destinations">
            {destinations.map((dest, index) => (
              <div key={index} className="card-bw p-4 relative space-y-4">
                <Input label="Destination Name" value={dest.name} onChange={(v: string) => handleDestinationChange(index, "name", v)} error={errors[`dest_name_${index}`]} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Connector Type"
                    value={dest.type}
                    onChange={(v: string) => handleDestinationChange(index, "type", v as DestinationType)}
                    options={[
                      { value: "REST", label: "REST" },
                      { value: "HL7", label: "HL7 (MLLP)" },
                      { value: "MLLP", label: "MLLP (Raw HL7)" },
                    ]}
                  />

                  <Select label="Outbound Data Type" value={dest.outboundDataType} onChange={(v: string) => handleDestinationChange(index, "outboundDataType", v as DataType)} options={dataTypeOptions} />
                </div>

                <Input label="Endpoint" value={dest.endpoint} onChange={(v: string) => handleDestinationChange(index, "endpoint", v)} placeholder="example: localhost:5000" error={errors[`dest_endpoint_${index}`]} />

                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "processing" })}>
                    <CodeIcon /> Transformer
                  </Button>

                  <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "response" })}>
                    <CodeIcon /> Response
                  </Button>

                  <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "template" })}>
                    <CodeIcon /> Template
                  </Button>
                </div>

                {destinations.length > 1 && (
                  <button type="button" onClick={() => handleRemoveDestination(index)} className="absolute top-2 right-2 text-red-500">
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}

            <Button type="button" variant="secondary" onClick={handleAddDestination}>
              Add Destination
            </Button>
          </Section>

          {errors.global && <p className="text-red-600 text-sm">{errors.global}</p>}
          {successMsg && <p className="text-green-700 text-sm">{successMsg}</p>}

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save Channel"}
            </Button>
          </div>
        </form>
      </Modal>

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

      {editingScriptForDestination && (
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
          title="Edit Script"
        />
      )}
    </>
  );
};

const Input: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
}> = ({ label, value, onChange, placeholder, error }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--text-soft)]">{label}</label>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-bw w-full px-3 py-2" />
    {error && <div className="text-red-500 text-xs">{error}</div>}
  </div>
);

const Select: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div className="space-y-1">
    <label className="text-sm text-[var(--text-soft)]">{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-bw w-full px-3 py-2">
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="space-y-3 pt-4 border-t">
    <h3 className="text-lg font-semibold">{title}</h3>
    {children}
  </div>
);

export default React.memo(ChannelForm);
