import React, { useState, useEffect, useCallback } from "react";
import { fetchChannels, createChannel, updateChannel, deleteChannel } from "../services/channel.api";
import { uploadXmlConfig } from "../services/upload.api";
import { Channel, ChannelFormData } from "../types";
import ChannelTable from "../page/ChannelTable";
import ChannelForm from "./ChannelForm";
import XmlUpload from "./XmlUpload";
import { Button } from "../components/shared/Button";
import { ErrorMessage } from "../components/shared/ErrorMessage";
import { ConnectionError } from "../components/shared/ConnectionError";
import { ConfirmationModal } from "../components/shared/ConfirmationModal";

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
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unknown error occurred.");
      }
      console.error(err);
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
      loadChannels(); // Refresh the list
    } catch (err) {
      console.error("Failed to delete channel", err);
      // You could set an error state here
    }
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
      loadChannels(); // Refresh the list
    } catch (err) {
      console.error("Failed to save channel", err);
      // You could set an error state here to show in the form
    }
  };

  const handleXmlUpload = async (file: File) => {
    try {
      const result = await uploadXmlConfig(file);
      console.log(result.message);
      loadChannels(); // Refresh list after upload
    } catch (err) {
      console.error("Failed to upload XML config", err);
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-full">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-indigo-500"></div>
        </div>
      );
    }

    if (error) {
      if (error.includes("Failed to fetch")) {
        return <ConnectionError onRetry={loadChannels} />;
      }
      return <ErrorMessage title="An Error Occurred" message={error} onRetry={loadChannels} />;
    }

    return <ChannelTable {...({ channels, onRefresh: loadChannels, onEdit: handleEdit, onDelete: handleDeleteRequest } as any)} />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white">Channel Dashboard</h2>
          <p className="text-slate-400 mt-1">Manage and monitor your integration channels.</p>
        </div>
        <div className="flex items-center gap-4">
          <XmlUpload onUpload={handleXmlUpload} />
          <Button onClick={handleCreateNew}>Create Channel</Button>
        </div>
      </div>

      {renderContent()}

      {React.useMemo(
        () => (
          <ChannelForm key={editingChannel ? `edit-${editingChannel.id}-${isFormOpen}` : `new-${isFormOpen}`} isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSubmit={handleFormSubmit} initialData={editingChannel} />
        ),
        [isFormOpen, editingChannel]
      )}

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
