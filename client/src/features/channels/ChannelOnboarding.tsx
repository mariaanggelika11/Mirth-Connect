import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
import { StatusBadge } from '../../components/ui/OperationalUI';
import { rotateSourceCredential, updateChannelStatus } from '../../services/channel.api';
import { api } from '../../services/api';
import type { Channel } from '../../types';
import { ChannelStatus } from '../../types';
import { SourceEndpoint } from './SourceEndpoint';
import { sourceRequest } from './sourceRequest';

export function ChannelOnboarding({
  channel,
  onClose,
  onChanged,
  onMessages,
}: {
  channel: Channel;
  onClose: () => void;
  onChanged: () => void;
  onMessages: () => void;
}) {
  const { can } = useAuth();
  const [status, setStatus] = useState(channel.status);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'key' | 'send' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const http = channel.source.type === 'HTTP';
  const running = status === ChannelStatus.RUNNING;
  async function action(work: () => Promise<void>) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this action');
      throw e;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Modal
        isOpen
        onClose={() => {
          if (!busy) onClose();
        }}
        title="Channel saved"
      >
        <div className="form-body form-section">
          <div className="channel-ready-heading">
            <h3>{channel.name}</h3>
            <StatusBadge status={status} />
          </div>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="alert success" role="status">
              {notice}
            </p>
          )}
          <div className="channel-ready-actions">
            {can('channel:operate') && (
              <Button
                type="button"
                disabled={busy || running}
                onClick={() => {
                  void action(async () => {
                    await updateChannelStatus(channel.id, ChannelStatus.RUNNING);
                    setStatus(ChannelStatus.RUNNING);
                    setNotice('Channel started');
                    onChanged();
                  }).catch(() => {});
                }}
              >
                {running ? 'Channel running' : 'Start channel'}
              </Button>
            )}
            <Button type="button" variant="secondary" disabled={busy} onClick={onMessages}>
              Open Messages
            </Button>
          </div>
          {http && can('channel:write') && (
            <section className="channel-key-setup form-section" aria-label="Source API key setup">
              <div className="channel-ready-heading">
                <div>
                  <strong>Source API key</strong>
                  <p>The sending system needs this key. New keys are shown only once.</p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm('key')}
                >
                  {key ? 'Rotate API key' : 'Create API key'}
                </Button>
              </div>
              {key && (
                <div className="credential-panel form-section">
                  <strong>Copy this key now. It disappears when you close this window.</strong>
                  <code className="break-anywhere">{key}</code>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(key)
                        .then(() => setNotice('API key copied'))
                        .catch(() => setError('Clipboard unavailable. Select and copy the key.'));
                    }}
                  >
                    Copy API key
                  </Button>
                </div>
              )}
            </section>
          )}
          <details className="channel-test-tools">
            <summary>Test this channel</summary>
            <div className="form-section">
              {http ? (
                <>
                  <SourceEndpoint channel={channel} />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy || !running || !key}
                    onClick={() => setConfirm('send')}
                  >
                    Send synthetic message
                  </Button>
                  {(!running || !key) && (
                    <small>Start the channel and create a key here to send a test.</small>
                  )}
                </>
              ) : (
                <p>
                  Send a synthetic HL7 message using your configured MLLP client and listener
                  transport settings.
                </p>
              )}
            </div>
          </details>
          <div className="form-actions">
            <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
      <ConfirmationModal
        isOpen={confirm === 'key'}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title="Create or rotate source API key"
        message="A new key immediately invalidates the previous key. Copy the new key before closing this window and update the source system."
        confirmLabel="Create key"
        onConfirm={() =>
          action(async () => {
            setKey('');
            setKey(await rotateSourceCredential(channel.id));
            setConfirm(null);
            setNotice('Source API key created');
          })
        }
      />
      <ConfirmationModal
        isOpen={confirm === 'send'}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title="Send synthetic message?"
        message="This sends a synthetic message through the running channel to its enabled destinations. It performs real network delivery. No patient data is included."
        confirmLabel="Send test request"
        onConfirm={() =>
          action(async () => {
            const request = sourceRequest(channel);
            const { data } = await api.post(`/message/inbound/${channel.id}`, request.body, {
              headers: {
                'Content-Type': request.contentType,
                'X-API-Key': key,
                'Idempotency-Key': crypto.randomUUID(),
              },
            });
            setConfirm(null);
            setNotice(
              `Test message received${data.result?.inboundMessageId ? ' · #' + data.result.inboundMessageId : ''}. Open Messages to verify each destination result.`,
            );
            onChanged();
          })
        }
      />
    </>
  );
}
