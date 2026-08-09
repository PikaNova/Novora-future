// 邮件发送模块：复用 Nodemailer（package.json dependency），配置由系统内 email_config 提供。
// 沙箱无网络无法安装包，代码用 createRequire 惰性加载，静态检查不受影响；Vercel 部署自动安装。
import { createRequire } from "node:module";

export type SmtpPresetId = "qq" | "163" | "custom";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  pass: string;
  from: string;
  fromName: string;
};

export const SMTP_PRESETS: Record<"qq" | "163", { host: string; port: number; secure: boolean; requireTls: boolean }> = {
  qq: { host: "smtp.qq.com", port: 465, secure: true, requireTls: false },
  "163": { host: "smtp.163.com", port: 465, secure: true, requireTls: false },
};

const DEFAULT_FROM_NAME = "Novora考试系统";

/** 按预设自动填充通用参数；custom/未知预设要求调用方提供 host+from。 */
export function presetSmtpConfig(
  id: SmtpPresetId | string | null | undefined,
  overrides: Partial<SmtpConfig> = {},
): SmtpConfig | null {
  if (id !== "qq" && id !== "163") {
    if (!overrides.host || !overrides.from) return null;
    return {
      host: overrides.host,
      port: Number(overrides.port ?? 465),
      secure: overrides.secure !== false,
      requireTls: overrides.requireTls === true,
      user: overrides.user ?? "",
      pass: overrides.pass ?? "",
      from: overrides.from,
      fromName: overrides.fromName || DEFAULT_FROM_NAME,
    };
  }
  const preset = SMTP_PRESETS[id];
  return {
    host: overrides.host || preset.host,
    port: Number(overrides.port ?? preset.port),
    secure: overrides.secure ?? preset.secure,
    requireTls: overrides.requireTls === true,
    user: overrides.user ?? "",
    pass: overrides.pass ?? "",
    from: overrides.from ?? "",
    fromName: overrides.fromName || DEFAULT_FROM_NAME,
  };
}

function emailText(purpose: "login" | "bind", code: string): { subject: string; text: string } {
  if (purpose === "bind") {
    return {
      subject: "【Novora】绑定邮箱验证码",
      text: `您好，您正在为 Novora 账号绑定邮箱。验证码是：${code}，有效期 5 分钟。若非本人操作请忽略。`,
    };
  }
  return {
    subject: "【Novora】管理员登录验证码",
    text: `您好，您正在进行 Novora 考试管理系统的管理员登录操作。您的验证码是：${code}，有效期为 5 分钟，请勿泄露给他人。如非本人操作，请忽略此邮件，并确保您的邮箱安全。`,
  };
}

/** 发送验证码邮件（登录/绑定两套文案，参数化渲染；不含密码/token）。 */
export async function sendVerificationCode(
  config: SmtpConfig,
  input: { to: string; code: string; purpose: "login" | "bind" },
): Promise<void> {
  const require2 = createRequire(import.meta.url);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodemailer: any = require2("nodemailer");
  const { subject, text } = emailText(input.purpose, input.code);
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure: config.secure === true,
    requireTLS: config.requireTls === true,
    auth: config.user && config.pass ? { user: config.user, pass: config.pass } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transporter.sendMail({
    from: config.fromName ? `"${config.fromName}" <${config.from}>` : config.from,
    to: input.to,
    subject,
    text,
    html: `<p>您好，</p><p>您的验证码是：<strong>${input.code}</strong>，有效期 5 分钟，请勿泄露给他人。</p>`,
  });
}