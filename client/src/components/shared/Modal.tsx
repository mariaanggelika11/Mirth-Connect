import React, { useEffect, useRef } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  keepMounted?: boolean; // tambahkan ini
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children }) => {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Tutup dengan tombol ESC
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  // 🧠 Jangan return null — selalu render, tapi sembunyikan via visibility
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isOpen ? "visible opacity-100" : "invisible opacity-0"} transition-opacity duration-200`} aria-modal="true" role="dialog">
      {/* Overlay */}
      <div
        ref={overlayRef}
        onClick={(e) => {
          if (e.target === overlayRef.current) onClose();
        }}
        className="absolute inset-0 bg-black/70"
      ></div>

      {/* Container tanpa transform supaya focus gak hilang */}
      <div className={`relative bg-slate-900 border border-slate-700 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden ${isOpen ? "translate-y-0" : "-translate-y-2"} transition-transform duration-200`}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="p-1 text-slate-400 rounded-full hover:bg-slate-700 hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
