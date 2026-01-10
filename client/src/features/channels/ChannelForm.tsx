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

const ChannelForm: React.FC<ChannelFormProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}) => {
  const [name, setName] = useState("");
  const [sourceConnectorType, setSourceConnectorType] = useState<"HTTP" | "HL7">(
    "HTTP"
  );
  const [sourceInboundDataType, setSourceInboundDataType] =
    useState<DataType>(DataType.HL7V2);
  const [sourceTransformerScript, setSourceTransformerScript] = useState("");
  const [editingSourceScript, setEditingSourceScript] = useState(false);
  const [destinations, setDestinations] = useState<DestinationFormData[]>([
    { ...DEFAULT_DESTINATION },
  ]);
  const [editingScriptForDestination, setEditingScriptForDestination] =
    useState<{
      index: number;
      type: "processing" | "response" | "template";
    } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const isEditing = !!initialData;

  useEffect(() => {
    if (!isOpen) return;

    if (isEditing && initialData) {
      setName(initialData.name || "");
      setSourceConnectorType(
        initialData.source?.type === "HL7" ? "HL7" : "HTTP"
      );
      setSourceInboundDataType(
        initialData.source?.inboundDataType || DataType.HL7V2
      );
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
      setSourceInboundDataType(DataType.HL7V2);
      setSourceTransformerScript("");
      setDestinations([{ ...DEFAULT_DESTINATION }]);
      setErrors({});
    }
  }, [isOpen, initialData, isEditing]);

  const handleAddDestination = () =>
    setDestinations((p) => [...p, { ...DEFAULT_DESTINATION }]);

  const handleRemoveDestination = (index: number) =>
    setDestinations((p) => p.filter((_, i) => i !== index));

  const handleDestinationChange = <
    K extends keyof DestinationFormData
  >(
    index: number,
    field: K,
    value: DestinationFormData[K]
  ) => {
    setDestinations((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleDestinationScriptSave = (script: string) => {
    if (!editingScriptForDestination) return;
    const { index, type } = editingScriptForDestination;
    if (type === "processing")
      handleDestinationChange(index, "processingScript", script);
    if (type === "response")
      handleDestinationChange(index, "responseScript", script);
    if (type === "template")
      handleDestinationChange(index, "templateScript", script);
    setEditingScriptForDestination(null);
  };

  const validateForm = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Channel name is required";
    destinations.forEach((d, i) => {
      if (!d.name.trim()) e[`dest_name_${i}`] = "Destination name is required";
      if (!d.endpoint.trim())
        e[`dest_endpoint_${i}`] = "Endpoint is required";
    });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validateForm()) return;
    setSubmitting(true);
    try {
      await onSubmit({
        name,
        source: {
          type: sourceConnectorType,
          inboundDataType: sourceInboundDataType,
        },
        processingScript: sourceTransformerScript,
        destinations,
      });
      onClose();
    } finally {
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
      <Modal isOpen={isOpen} onClose={onClose} title="Create / Edit Channel">
        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          <Input
            label="Channel Name"
            value={name}
            onChange={setName}
            error={errors.name}
          />

          <Section title="Source Connector">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Select
                label="Source Connector Type"
                value={sourceConnectorType}
                options={sourceConnectorOptions}
                onChange={setSourceConnectorType}
              />
              <Select
                label="Inbound Data Type"
                value={sourceInboundDataType}
                options={dataTypeOptions}
                onChange={setSourceInboundDataType}
              />
            </div>

            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditingSourceScript(true)}
            >
              <CodeIcon /> Transformer Script
            </Button>
          </Section>

          <Section title="Destinations">
            {destinations.map((dest, index) => (
              <div key={index} className="card-bw p-4 space-y-4 relative">
                <Input
                  label="Destination Name"
                  value={dest.name}
                  onChange={(v) =>
                    handleDestinationChange(index, "name", v)
                  }
                  error={errors[`dest_name_${index}`]}
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Select
                    label="Connector Type"
                    value={dest.type}
                    options={[
                      { value: "REST", label: "REST" },
                      { value: "HL7", label: "HL7" },
                      { value: "MLLP", label: "MLLP" },
                    ]}
                    onChange={(v) =>
                      handleDestinationChange(
                        index,
                        "type",
                        v as DestinationType
                      )
                    }
                  />
                  <Select
                    label="Outbound Data Type"
                    value={dest.outboundDataType}
                    options={dataTypeOptions}
                    onChange={(v) =>
                      handleDestinationChange(
                        index,
                        "outboundDataType",
                        v as DataType
                      )
                    }
                  />
                </div>

                <Input
                  label="Endpoint"
                  value={dest.endpoint}
                  onChange={(v) =>
                    handleDestinationChange(index, "endpoint", v)
                  }
                  error={errors[`dest_endpoint_${index}`]}
                />

                <div className="flex gap-2">
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
                    <CodeIcon /> Transformer
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
                    <CodeIcon /> Response
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
                    <CodeIcon /> Template
                  </Button>
                </div>

                {destinations.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveDestination(index)}
                    className="absolute top-2 right-2 text-red-500"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            ))}

            <Button
              type="button"
              variant="secondary"
              onClick={handleAddDestination}
            >
              Add Destination
            </Button>
          </Section>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              Save Channel
            </Button>
          </div>
        </form>
      </Modal>

      {editingSourceScript && (
        <ScriptEditorModal
          isOpen
          onClose={() => setEditingSourceScript(false)}
          onSave={(s) => {
            setSourceTransformerScript(s)
            setEditingSourceScript(false)
          }}
          initialScript={sourceTransformerScript}
          title="Edit Source Transformer Script"
          scriptType="transformer"
        />
      )}


      {editingScriptForDestination && (
        <ScriptEditorModal
          isOpen
          onClose={() => setEditingScriptForDestination(null)}
          onSave={handleDestinationScriptSave}
          initialScript={
            editingScriptForDestination.type === "processing"
              ? destinations[editingScriptForDestination.index]?.processingScript || ""
              : editingScriptForDestination.type === "response"
              ? destinations[editingScriptForDestination.index]?.responseScript || ""
              : destinations[editingScriptForDestination.index]?.templateScript || ""
          }
          title={`Edit ${editingScriptForDestination.type} Script`}
          scriptType={
            editingScriptForDestination.type === "processing"
              ? "transformer"
              : editingScriptForDestination.type === "response"
              ? "response"
              : "template"
          }
        />
      )}
    </>
  );
};

const Input: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}> = ({ label, value, onChange, error }) => (
  <div className="space-y-1">
    <label className="text-sm">{label}</label>
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input-bw w-full px-3 py-2"
    />
    {error && <div className="text-xs text-red-500">{error}</div>}
  </div>
);

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps<T extends string> {
  label: string;
  value: T;
  options: SelectOption[];
  onChange: (value: T) => void;
}

const Select = <T extends string>({
  label,
  value,
  options,
  onChange,
}: SelectProps<T>) => (
  <div className="space-y-1">
    <label className="text-sm">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="input-bw w-full px-3 py-2"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div className="space-y-3 pt-4 border-t">
    <h3 className="text-lg font-semibold">{title}</h3>
    {children}
  </div>
);

export default React.memo(ChannelForm);
