import React, { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export default function SettingsCollapsibleCard({
  storageKey,
  title,
  icon,
  badge,
  danger = false,
  children,
}: {
  storageKey: string;
  title: string;
  icon?: ReactNode;
  badge?: string;
  danger?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, open ? '1' : '0');
    } catch {
      /* 忽略存储异常 */
    }
  }, [open, storageKey]);

  return (
    <section className={'set-card set-collapse' + (danger ? ' set-collapse--danger' : '')}>
      <button
        type="button"
        className="set-collapse__toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="set-collapse__label">
          {icon}
          <span className="set-collapse__title">{title}</span>
          {badge ? <em className="set-collapse__badge">{badge}</em> : null}
        </span>
        <ChevronDown size={17} className={'set-collapse__chevron' + (open ? ' is-open' : '')} aria-hidden="true" />
      </button>
      {open && <div className="set-collapse__body">{children}</div>}
    </section>
  );
}
