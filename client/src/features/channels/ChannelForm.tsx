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
      const { index, type } = editingScriptForDestination;
      if (type === "processing") handleDestinationChange(index, "processingScript", script);
      else if (type === "response") handleDestinationChange(index, "responseScript", script);
      else if (type === "template") handleDestinationChange(index, "templateScript", script);
      setEditingScriptForDestination(null);
    }
  };

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
        <form onSubmit={handleSubmit}>
          <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
            <Input label="Channel Name" value={name} onChange={setName} error={errors.name} />

            <Section title="Source Connector">
              <Select label="Source Connector Type" value={sourceConnectorType} onChange={(v) => setSourceConnectorType(v as "HTTP" | "HL7")} options={sourceConnectorOptions} />

              {autoEndpoint && (
                <div>
                  <label style={{ fontSize: 13, color: "var(--text-soft)" }}>Auto Generated Endpoint</label>
                  <input value={autoEndpoint} readOnly className="input-bw" />
                </div>
              )}

              <Select label="Inbound Data Type" value={sourceInboundDataType} onChange={(v) => setSourceInboundDataType(v as DataType)} options={dataTypeOptions} />

              <Button type="button" variant="secondary" onClick={() => setEditingSourceScript(true)}>
                <CodeIcon /> {sourceTransformerScript ? "Edit Source Script" : "Add Source Script"}
              </Button>
            </Section>

            <Section title="Destinations">
              {destinations.map((dest, index) => (
                <div key={index} className="card-bw" style={{ padding: 16, position: "relative" }}>
                  <Input label="Destination Name" value={dest.name} onChange={(v) => handleDestinationChange(index, "name", v)} error={errors[`dest_name_${index}`]} />

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <Select
                      label="Connector Type"
                      value={dest.type}
                      onChange={(v) => handleDestinationChange(index, "type", v)}
                      options={[
                        { value: "REST", label: "REST" },
                        { value: "HL7", label: "HL7 (MLLP)" },
                        { value: "MLLP", label: "MLLP (Raw HL7)" },
                      ]}
                    />

                    <Select label="Outbound Data Type" value={dest.outboundDataType} onChange={(v) => handleDestinationChange(index, "outboundDataType", v)} options={dataTypeOptions} />
                  </div>

                  <Input label="Endpoint" value={dest.endpoint} onChange={(v) => handleDestinationChange(index, "endpoint", v)} placeholder="example: localhost:5000" error={errors[`dest_endpoint_${index}`]} />

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "processing" })}>
                      <CodeIcon /> {dest.processingScript ? "Edit Transformer" : "Add Transformer"}
                    </Button>

                    <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "response" })}>
                      <CodeIcon /> {dest.responseScript ? "Edit Response" : "Add Response"}
                    </Button>

                    <Button type="button" variant="secondary" onClick={() => setEditingScriptForDestination({ index, type: "template" })}>
                      <CodeIcon /> {dest.templateScript ? "Edit Template" : "Add Template"}
                    </Button>
                  </div>

                  {destinations.length > 1 && (
                    <button type="button" onClick={() => handleRemoveDestination(index)} className="icon-btn icon-btn-danger" style={{ position: "absolute", top: 8, right: 8 }}>
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}

              <Button type="button" variant="secondary" onClick={handleAddDestination}>
                Add Destination
              </Button>
            </Section>

            {errors.global && <p style={{ color: "var(--danger)", fontSize: 13 }}>{errors.global}</p>}

            {successMsg && <p style={{ color: "#047857", fontSize: 13 }}>{successMsg}</p>}
          </div>

          <div
            style={{
              padding: "16px 24px",
              display: "flex",
              justifyContent: "flex-end",
              gap: 12,
              borderTop: "1px solid var(--border-main)",
              background: "var(--bg-soft)",
            }}
          >
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

const Input = ({ label, value, onChange, placeholder, error }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; error?: string }) => (
  <div>
    <label style={{ fontSize: 13, color: "var(--text-soft)" }}>{label}</label>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-bw" />
    {error && <div style={{ color: "var(--danger)", fontSize: 12 }}>{error}</div>}
  </div>
);

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
  <div>
    <label style={{ fontSize: 13, color: "var(--text-soft)" }}>{label}</label>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="input-bw">
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  </div>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div style={{ borderTop: "1px solid var(--border-main)", paddingTop: 12 }}>
    <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>{title}</h3>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
  </div>
);

export default React.memo(ChannelForm);
