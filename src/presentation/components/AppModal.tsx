import React, { ReactNode } from 'react';
import { X } from 'lucide-react';

type AppModalTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
type AppModalSize = 'sm' | 'md' | 'lg' | 'xl';

type AppModalProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  tone?: AppModalTone;
  size?: AppModalSize;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

const toneClass: Record<AppModalTone, string> = {
  neutral: 'bg-[#5A5A40]',
  success: 'bg-emerald-600',
  warning: 'bg-amber-600',
  danger: 'bg-red-600',
  info: 'bg-blue-600',
};

const sizeClass: Record<AppModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

export const AppModal: React.FC<AppModalProps> = ({
  open,
  title,
  subtitle,
  tone = 'neutral',
  size = 'md',
  onClose,
  children,
  footer,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className={`bg-white rounded-3xl shadow-2xl w-full ${sizeClass[size]} max-h-[90vh] border border-[#5A5A40]/10 overflow-hidden flex flex-col`}>
        <div className={`px-6 py-4 text-white flex items-center justify-between ${toneClass[tone]}`}>
          <div>
            <h3 className="text-xl font-bold">{title}</h3>
            {subtitle && <p className="text-sm text-white/80 mt-1">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" aria-label="Закрыть окно">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>

        {footer && <div className="p-6 border-t border-[#5A5A40]/10">{footer}</div>}
      </div>
    </div>
  );
};
