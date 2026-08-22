import { Mail } from 'lucide-react';
import EmailServicePanel from '../EmailServicePanel';

export default function EmailServiceSection({
  canEditSettings,
  canEditPolicy,
}: {
  canEditSettings: boolean;
  canEditPolicy: boolean;
}) {
  return (
    <section className="set-card">
      <div className="set-card__head">
        <h2 className="set-card__title">
          <Mail size={20} />
          邮件服务（验证码登录）
        </h2>
      </div>
      <p className="set-card__lead">
        配置 SMTP 后启用邮箱验证码登录与账号绑定；未配置时登录页不显示验证码入口。授权码会加密存储，不会明文返回。
      </p>
      <EmailServicePanel canEditSettings={canEditSettings} showPolicy canEditPolicy={canEditPolicy} />
    </section>
  );
}
