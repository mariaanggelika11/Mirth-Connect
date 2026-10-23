import { createPortal } from 'react-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../../components/ui/Modal';
import { ConfirmationModal } from '../../components/ui/ConfirmationModal';
interface Props {
  logoutConfirmationOpen: boolean;
  onRequestLogout: () => void;
  onCancelLogout: () => void;
}
export default function SessionWarning({
  logoutConfirmationOpen,
  onRequestLogout,
  onCancelLogout,
}: Props) {
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
          <button type="button" className="btn-secondary" onClick={onRequestLogout}>
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
      <ConfirmationModal
        isOpen={logoutConfirmationOpen}
        onClose={onCancelLogout}
        onConfirm={() => {
          onCancelLogout();
          logout();
        }}
        title="Log out"
        message="Are you sure you want to log out?"
        confirmLabel="Log out"
      />
    </div>,
    document.body,
  );
}
