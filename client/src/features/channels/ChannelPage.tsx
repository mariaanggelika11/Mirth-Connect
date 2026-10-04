import { useAuth } from '../../contexts/AuthContext';
import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchChannels,
  createChannel,
  updateChannel,
  deleteChannel,
} from '../../services/channel.api';
import { uploadXmlConfig } from '../../services/upload.api';
import { Channel, ChannelFormData } from '../../types';

import ChannelTable from './ChannelTable';
import { channelConfiguration } from '../../services/channel.config';
import { PageHeading, RefreshButton } from '../../components/ui/OperationalUI';
import { Search, Plus } from 'lucide-react';
import ChannelForm from './ChannelForm';
import XmlUpload from './XmlUpload';

import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { ConnectionError } from '../../components/ui/ConnectionError';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';

const ChannelDashboard: React.FC<{
  initialChannelId?: string;
  onViewMessages?: (id: number) => void;
}> = ({ initialChannelId = '', onViewMessages }) => {
  const [search, setSearch] = useState(initialChannelId ? '#' + initialChannelId : '');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const { can } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [duplicateSeed, setDuplicateSeed] = useState<ChannelFormData | null>(null);
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
      else setError('An unknown error occurred.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleCreateNew = () => {
    setDuplicateSeed(null);
    setEditingChannel(null);
    setIsFormOpen(true);
  };

  const handleEdit = (channel: Channel) => {
    setDuplicateSeed(null);
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
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Operation failed');
      throw error;
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
      loadChannels();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Save failed');
      throw error;
    }
  };

  const handleXmlUpload = async (file: File) => {
    try {
      await uploadXmlConfig(file);
      loadChannels();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Import failed');
    }
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 200 }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '3px solid var(--border-main)',
              borderTop: '3px solid var(--primary)',
              animation: 'spin 1s linear infinite',
            }}
          />
        </div>
      );
    }

    if (error) {
      if (error.includes('Failed to fetch')) {
        return <ConnectionError onRetry={loadChannels} />;
      }
      return <ErrorMessage title="An Error Occurred" message={error} onRetry={loadChannels} />;
    }

    return (
      <ChannelTable
        channels={channels.filter(
          (c) =>
            (statusFilter === 'ALL' || c.status === statusFilter) &&
            (search.startsWith('#')
              ? String(c.id) === search.slice(1)
              : [c.name, c.source.type, c.source.endpoint || ''].some((v) =>
                  String(v || '')
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )),
        )}
        onViewMessages={onViewMessages}
        onDuplicate={(channel) => {
          setEditingChannel(null);
          setDuplicateSeed({
            ...channelConfiguration(channel),
            name: channel.name.slice(0, 143) + ' (copy)',
          });
          setIsFormOpen(true);
        }}
        onRefresh={loadChannels}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
      />
    );
  };

  return (
    <div className="page-stack">
      <PageHeading
        title="Channels"
        description="Manage every connection from source to destination."
        actions={
          <>
            <RefreshButton onClick={() => void loadChannels()} loading={loading} />
            {can('channel:write') && (
              <>
                <XmlUpload onUpload={handleXmlUpload} />
                <Button onClick={handleCreateNew}>
                  <Plus size={16} />
                  New Channel
                </Button>
              </>
            )}
          </>
        }
      />
      <div className="filter-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search channels"
            placeholder="Search channels or source…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Channel status"
          className="input-bw"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="ALL">All statuses</option>
          {['RUNNING', 'STOPPED', 'PAUSED', 'ERROR'].map((s) => (
            <option key={s} value={s}>
              {s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <span className="toolbar-count">{channels.length} configured</span>
      </div>
      {/* TABLE */}
      {renderContent()}

      {/* FORM MODAL */}
      <ChannelForm
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        initialData={editingChannel}
        seedData={duplicateSeed}
      />

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
