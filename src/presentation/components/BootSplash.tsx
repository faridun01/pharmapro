import React, { useEffect, useMemo, useState } from 'react';
import { Cross, Pill } from 'lucide-react';

export const BootSplash: React.FC<{
  title?: string;
  subtitle?: string;
  compact?: boolean;
  note?: string;
  showProgress?: boolean;
  durationMs?: number;
}> = ({
  title = 'PharmaPro',
  subtitle = 'Подготавливаем рабочее пространство и подключаем данные аптеки',
  compact = false,
  note = 'Secure pharmacy workspace',
  showProgress = !compact,
  durationMs = 5000,
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!showProgress) {
      setProgress(0);
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const nextProgress = Math.min(100, Math.round((elapsed / durationMs) * 100));
      setProgress(nextProgress);
    }, 50);

    setProgress(0);

    return () => window.clearInterval(timer);
  }, [durationMs, showProgress]);

  const progressLabel = useMemo(() => {
    if (!showProgress) {
      return 'Syncing';
    }

    if (progress < 34) return 'Initializing';
    if (progress < 68) return 'Securing';
    if (progress < 100) return 'Preparing';
    return 'Ready';
  }, [progress, showProgress]);

  return (
    <div className={`pharma-splash ${compact ? 'pharma-splash--compact' : ''}`}>
      <div className="pharma-splash__backdrop">
        <div className="pharma-splash__orb pharma-splash__orb--left" />
        <div className="pharma-splash__orb pharma-splash__orb--right" />
        <div className="pharma-splash__cross pharma-splash__cross--top" />
        <div className="pharma-splash__cross pharma-splash__cross--bottom" />
        <div className="pharma-splash__grid" />
      </div>

      <div className="pharma-splash__card">
        <div className="pharma-splash__sheen" />

        <div className="pharma-splash__badge">
          <Cross size={compact ? 14 : 16} strokeWidth={2.1} />
          <span>{note}</span>
        </div>

        <div className="pharma-splash__logo-wrap">
          <div className="pharma-splash__logo-ring" />
          <div className="pharma-splash__emblem">
            <div className="pharma-splash__emblem-mark">
              <Cross size={compact ? 16 : 18} strokeWidth={2.1} />
            </div>
          </div>
          <div className="pharma-splash__logo-core">
            <Pill size={compact ? 28 : 34} strokeWidth={2.1} />
          </div>
        </div>

        <div className="pharma-splash__content">
          <div className="pharma-splash__eyebrow">PHARMACY RETAIL SYSTEM</div>
          <h1 className="pharma-splash__title">{title}</h1>
          <p className="pharma-splash__subtitle">{subtitle}</p>
        </div>

        <div className="pharma-splash__chips" aria-hidden="true">
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Standard</span>
            <span className="pharma-splash__chip-value">GDP Ready</span>
          </div>
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Status</span>
            <span className="pharma-splash__chip-value">Secure Sync</span>
          </div>
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Mode</span>
            <span className="pharma-splash__chip-value">Premium Retail</span>
          </div>
        </div>

        <div className="pharma-splash__loader" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        {showProgress ? (
          <>
            <div className="pharma-splash__progress" aria-hidden="true">
              <div className="pharma-splash__progress-bar" style={{ transform: `translateX(${progress - 100}%)` }} />
            </div>
            <div className="pharma-splash__progress-meta">
              <span className="pharma-splash__progress-state">{progressLabel}</span>
              <span className="pharma-splash__progress-value">{progress}%</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
};