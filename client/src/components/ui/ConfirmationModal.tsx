import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { Button } from './Button';
interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
}
export function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm Delete',
}: Props) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (isOpen) setError('');
  }, [isOpen]);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this action');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!busy) onClose();
      }}
      title={title}
    >
      <div className="form-body">
        <p className="muted">{message}</p>
        {error && (
          <div role="alert" className="alert error">
            {error}
          </div>
        )}
        <div className="form-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void confirm()}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
