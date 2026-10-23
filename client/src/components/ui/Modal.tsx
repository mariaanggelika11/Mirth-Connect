import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  variant?: 'dialog' | 'drawer';
  dismissible?: boolean;
  className?: string;
}
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  variant = 'dialog',
  dismissible = true,
  className = '',
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null),
    titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'summary,button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ) || [],
      ).filter((el) => {
        if (el.offsetParent === null) return false;
        // Closed disclosures may still report an offsetParent for hidden descendants.
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          if (
            parent instanceof HTMLDetailsElement &&
            !parent.open &&
            !parent.querySelector(':scope > summary')?.contains(el)
          )
            return false;
        }
        return true;
      });
    focusable()[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (e.key === 'Escape' && dismissible) {
        // Let the browser dismiss an open native picker before closing its dialog.
        if (CSS.supports('selector(select:open)') && ref.current?.querySelector('select:open'))
          return;
        e.preventDefault();
        e.stopImmediatePropagation();
        closeRef.current();
      }
      if (e.key === 'Tab') {
        const elements = focusable();
        const first = elements[0],
          last = elements[elements.length - 1];
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [isOpen, dismissible]);
  if (!isOpen) return null;
  return (
    <div
      className={`modal-overlay ${variant === 'drawer' ? 'drawer-overlay' : ''}`}
      onMouseDown={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal-window ${variant === 'drawer' ? 'drawer-window' : ''} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          {dismissible && (
            <button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
