import React, { useState, useEffect, useCallback } from "react";
import { fetchChannels, createChannel, updateChannel, deleteChannel } from "../../services/channel.api";
import { uploadXmlConfig } from "../../services/upload.api";
import { Channel, ChannelFormData } from "../../types";

import ChannelTable from "./ChannelTable";
import ChannelForm from "./ChannelForm";
import XmlUpload from "./XmlUpload";

import { Button } from "../../components/ui/Button";
import { ErrorMessage } from "../../components/ui/ErrorMessage";
import { ConnectionError } from "../../components/ui/ConnectionError";
import { ConfirmationModal } from "../../components/ui/ConfirmationModal";

const ChannelDashboard: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Channel | null>(null);
  const [deletingChannel, setDeletingChannel] = useState<Channel | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchChannels();
      setChannels(data);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError("An unknown error occurred.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleCreateNew = () => {
    setEditingChannel(null);
    setIsFormOpen(true);
  };

  const handleEdit = (channel: Channel) => {
    setEditingChannel(channel);
    setIsFormOpen(true);
  };

  const handleDeleteRequest = (channel: Channel) => {
    setDeletingChannel(channel);
  };

  const handleDeleteConfirm = async () => {
    if (!deletingChannel) return;
    try {
      await deleteChannel(deletingChannel.id);
      setDeletingChannel(null);
      loadChannels();
    } catch {}
  };

  const handleFormSubmit = async (channelData: ChannelFormData) => {
    try {
      if (editingChannel) {
        await updateChannel(editingChannel.id, channelData);
      } else {
        await createChannel(channelData);
      }
      setIsFormOpen(false);
      setEditingChannel(null);
      loadChannels();
    } catch {}
  };

  const handleXmlUpload = async (file: File) => {
    try {
      await uploadXmlConfig(file);
      loadChannels();
    } catch {}
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 200 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              border: "3px solid var(--border-main)",
              borderTop: "3px solid var(--primary)",
              animation: "spin 1s linear infinite",
            }}
          />
        </div>
      );
    }

    if (error) {
      if (error.includes("Failed to fetch")) {
        return <ConnectionError onRetry={loadChannels} />;
      }
      return <ErrorMessage title="An Error Occurred" message={error} onRetry={loadChannels} />;
    }

    return (
      <ChannelTable
        {...({
          channels,
          onRefresh: loadChannels,
          onEdit: handleEdit,
          onDelete: handleDeleteRequest,
        } as any)}
      />
    );
  };

  return (
    // ✅ FULL WIDTH – SAMA DENGAN MONITOR VIEW
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* HEADER CARD – SAMA DENGAN MONITOR */}
      <div
        className="card-bw"
        style={{
          padding: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700 }}>Channels</h2>
          <p style={{ color: "var(--text-soft)", fontSize: 14 }}>Manage and monitor your HL7 and HTTP integration channels.</p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <XmlUpload onUpload={handleXmlUpload} />
          <Button onClick={handleCreateNew}>New Channel</Button>
        </div>
      </div>

      {/* TABLE */}
      {renderContent()}

      {/* FORM MODAL */}
      {React.useMemo(
        () => (
          <ChannelForm key={editingChannel ? `edit-${editingChannel.id}-${isFormOpen}` : `new-${isFormOpen}`} isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSubmit={handleFormSubmit} initialData={editingChannel} />
        ),
        [isFormOpen, editingChannel]
      )}

      {/* DELETE CONFIRMATION */}
      <ConfirmationModal
        isOpen={!!deletingChannel}
        onClose={() => setDeletingChannel(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Channel"
        message={`Are you sure you want to permanently delete the channel "${deletingChannel?.name}"? This action cannot be undone.`}
      />
    </div>
  );
};

export default ChannelDashboard;
