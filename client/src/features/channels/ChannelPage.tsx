import { useAuth } from '../../contexts/AuthContext';
import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  archiveChannel,
} from '../../services/channel.api';
import { uploadXmlConfig } from '../../services/upload.api';
import type { Channel, ChannelFormData } from '../../types';

import { RevisionPanel } from './RevisionPanel';
import ChannelTable from './ChannelTable';
import { channelConfiguration } from '../../services/channel.config';
import { PageHeading, RefreshButton } from '../../components/ui/OperationalUI';
import { Search, Plus } from 'lucide-react';
import ChannelForm from './ChannelForm';
import XmlUpload from './XmlUpload';
import { ChannelOnboarding } from './ChannelOnboarding';
import { ChannelStatus } from '../../types';

import { Button } from '../../components/ui/Button';
import { ErrorMessage } from '../../components/ui/ErrorMessage';
import { ConnectionError } from '../../components/ui/ConnectionError';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';

const ChannelDashboard: React.FC<{
  initialChannelId?: string;
  onViewMessages?: (id: number) => void;
}> = ({ initialChannelId = '', onViewMessages }) => {
  const [revisionChannel, setRevisionChannel] = useState<Channel | null>(null);
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
  const [savedChannel, setSavedChannel] = useState<Channel | null>(null);
  const [notice, setNotice] = useState('');
  const [draftChannelId, setDraftChannelId] = useState<number | null>(null);
  const [archivingChannel, setArchivingChannel] = useState<Channel | null>(null);
  const [replaceDraftChannel, setReplaceDraftChannel] = useState<Channel | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchChannels(statusFilter === 'ARCHIVED');
      setChannels(data);
    } catch (err) {
      if (err instanceof Error) setError(err.message);
      else setError('An unknown error occurred.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  const handleCreateNew = () => {
    setDuplicateSeed(null);
    setEditingChannel(null);
    setIsFormOpen(true);
  };

  const handleEdit = (channel: Channel) => {
    if (channel.draftRevision) {
      setReplaceDraftChannel(channel);
      return;
    }
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
      throw error;
    }
  };

  const handleFormSubmit = async (channelData: ChannelFormData) => {
    try {
      if (editingChannel) {
        await updateChannel(editingChannel.id, channelData);
        setNotice('Draft saved. Your active configuration is unchanged until you publish.');
        setDraftChannelId(editingChannel.id);
      } else {
        const result = await createChannel(channelData);
        setNotice('Channel saved');
        setSavedChannel({
          ...channelData,
          id: result.channelId,
          status: ChannelStatus.STOPPED,
          source: { ...channelData.source, endpoint: result.sourceEndpoint },
        });
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
        onRevisions={setRevisionChannel}
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
        onArchive={setArchivingChannel}
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
          {['RUNNING', 'STOPPED', 'PAUSED', 'ERROR', 'ARCHIVED'].map((s) => (
            <option key={s} value={s}>
              {s[0] + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <span className="toolbar-count">{channels.length} configured</span>
      </div>
      {notice && (
        <p className="alert success" role="status">
          {notice}
          {draftChannelId && can('channel:write') && (
            <Button
              variant="secondary"
              onClick={() => {
                const channel = channels.find((c) => c.id === draftChannelId);
                if (channel) setRevisionChannel(channel);
              }}
            >
              Review and publish draft
            </Button>
          )}
        </p>
      )}
      {/* TABLE */}
      {renderContent()}

      {revisionChannel && can('channel:write') && (
        <RevisionPanel
          channel={revisionChannel}
          onClose={() => setRevisionChannel(null)}
          onChanged={() => void loadChannels()}
          onPublished={(revision) => {
            setDraftChannelId(null);
            setNotice(`Revision ${revision} is now active for new messages.`);
          }}
        />
      )}
      {/* FORM MODAL */}
      <ConfirmationModal
        isOpen={!!replaceDraftChannel}
        onClose={() => setReplaceDraftChannel(null)}
        title="This channel has a saved draft"
        confirmLabel="Edit active configuration"
        message={`Draft ${replaceDraftChannel?.draftRevision} is not published. Editing starts from the active configuration; saving will replace the pending draft. Cancel and choose Review draft to continue reviewing the saved changes.`}
        onConfirm={() => {
          setDuplicateSeed(null);
          setEditingChannel(replaceDraftChannel);
          setReplaceDraftChannel(null);
          setIsFormOpen(true);
        }}
      />
      <ChannelForm
        isOpen={isFormOpen && can('channel:write')}
        onClose={() => setIsFormOpen(false)}
        onSubmit={handleFormSubmit}
        initialData={editingChannel}
        seedData={duplicateSeed}
      />
      {savedChannel && can('channel:write') && (
        <ChannelOnboarding
          key={savedChannel.id}
          channel={channels.find((c) => c.id === savedChannel.id) || savedChannel}
          onClose={() => setSavedChannel(null)}
          onChanged={() => void loadChannels()}
          onMessages={() => {
            const id = savedChannel.id;
            setSavedChannel(null);
            onViewMessages?.(id);
          }}
        />
      )}

      {/* DELETE CONFIRMATION */}
      <ConfirmationModal
        isOpen={!!deletingChannel}
        onClose={() => setDeletingChannel(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Channel"
        message={`Delete "${deletingChannel?.name}" permanently? Only stopped channels without message history can be deleted. Their configuration revisions will also be removed. Use Archive for channels with history.`}
      />
      <ConfirmationModal
        isOpen={!!archivingChannel}
        onClose={() => setArchivingChannel(null)}
        title="Archive Channel"
        confirmLabel="Archive channel"
        message={`Archive "${archivingChannel?.name}"? It must be stopped with no pending work. Messages, revisions and audit history will be preserved. Find it later using the Archived status filter.`}
        onConfirm={async () => {
          if (!archivingChannel) return;
          await archiveChannel(archivingChannel.id);
          setArchivingChannel(null);
          setNotice('Channel archived. Messages and revision history are preserved.');
          await loadChannels();
        }}
      />
    </div>
  );
};

export default ChannelDashboard;
