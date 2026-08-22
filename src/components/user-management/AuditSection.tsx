import React from 'react';
import Mascot from '../Mascot';
import { ACTION_LABEL } from '../../constants/permissions';
import type { AuditLog } from '../../services/adminUsers';
import { fmt } from './helpers';

export default function AuditSection({ logs }: { logs: AuditLog[] }) {
  return (
    <div className="user-management__audit">
      {logs.length ? (
        logs.map((log) => (
          <div className="user-management__audit-row" key={log.id}>
            <time>{fmt(log.createdAt)}</time>
            <strong>{log.username || '系统'}</strong>
            <span>{ACTION_LABEL[log.action] || log.action}</span>
            <code>{log.resourceId || log.resourceType}</code>
          </div>
        ))
      ) : (
        <div className="admin-empty">
          <Mascot className="mascot-empty" size={64} alt="" />
          <p>暂无操作记录</p>
        </div>
      )}
    </div>
  );
}
