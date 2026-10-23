import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../components/ui/Modal';
export default function SessionWarning() {
  const {
    sessionWarningSeconds,
    continueSession,
    logout,
    isContinuingSession,
    sessionActivityError,
  } = useAuth();
  return createPortal(
    <div className="session-warning-layer">
      <Modal
        isOpen={sessionWarningSeconds !== null}
        title="Session expiring"
        onClose={() => {}}
        dismissible={false}
      >
        <p>
          Your session will end in {sessionWarningSeconds ?? 0} seconds. Continue to keep working,
          or sign out.
        </p>
        <p className="session-warning-note">
          Sessions also have a maximum duration. Continuing does not extend that limit.
        </p>
        {sessionActivityError && (
          <p role="alert" className="session-warning-error">
            {sessionActivityError}
          </p>
        )}
        <div className="session-warning-actions">
          <button type="button" className="btn-secondary" onClick={logout}>
            Sign out
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={isContinuingSession}
            onClick={() => {
              void continueSession().catch(() => {});
            }}
          >
            {isContinuingSession ? 'Continuing…' : 'Continue session'}
          </button>
        </div>
      </Modal>
    </div>,
    document.body,
  );
}
