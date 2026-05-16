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
  note = 'Решение ITFORCE',
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
      return 'Синхронизация';
    }

    if (progress < 34) return 'Запуск';
    if (progress < 68) return 'Подключение';
    if (progress < 100) return 'Подготовка';
    return 'Готово';
  }, [progress, showProgress]);

  return (
    <div className={`pharma-splash ${compact ? 'pharma-splash--compact' : ''}`}>
      <div className="pharma-splash__backdrop">
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
          <div className="pharma-splash__eyebrow">АПТЕЧНАЯ СИСТЕМА УПРАВЛЕНИЯ</div>
          <h1 className="pharma-splash__title">{title}</h1>
          <p className="pharma-splash__subtitle">{subtitle}</p>
        </div>

        <div className="pharma-splash__chips" aria-hidden="true">
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Партнер</span>
            <span className="pharma-splash__chip-value">ITFORCE</span>
          </div>
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Статус</span>
            <span className="pharma-splash__chip-value">Безопасный запуск</span>
          </div>
          <div className="pharma-splash__chip">
            <span className="pharma-splash__chip-label">Режим</span>
            <span className="pharma-splash__chip-value">Поддержка ITFORCE</span>
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
