import React, { useEffect, useState } from 'react';

export type SettingsGroup = { id: string; label: string };

export default function SettingsGroupNav({ groups }: { groups: SettingsGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id ?? '');

  useEffect(() => {
    const nodes = groups
      .map((g) => document.getElementById('set-group-' + g.id))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-group');
            if (id) setActive(id);
          }
        }
      },
      { rootMargin: '-18% 0px -72% 0px', threshold: 0 },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [groups]);

  const jump = (id: string) => {
    document.getElementById('set-group-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav className="set-group-nav" aria-label="设置分组">
      {groups.map((g) => (
        <button key={g.id} type="button" className={active === g.id ? 'is-active' : ''} onClick={() => jump(g.id)}>
          {g.label}
        </button>
      ))}
    </nav>
  );
}
