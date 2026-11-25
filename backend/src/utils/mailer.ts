import nodemailer from "nodemailer";
import { env } from "../config/env";

type MailTransporter = ReturnType<typeof nodemailer.createTransport>;
let cachedTestTransporter: MailTransporter | null = null;

async function getTransporter(): Promise<{ transporter: MailTransporter; mode: "smtp" | "ethereal" | "console" }> {
  if (env.SMTP_USER && env.SMTP_PASS) {
    const port = env.SMTP_PORT || 587;
    const transporter = nodemailer.createTransport({
      host: env.SMTP_HOST || "smtp.gmail.com",
      port,
      secure: env.SMTP_SECURE === "true" || port === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
    return { transporter, mode: "smtp" };
  }

  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return {
      transporter: nodemailer.createTransport({ jsonTransport: true }),
      mode: "console",
    };
  }

  // Fallback to free Nodemailer Ethereal test account when SMTP credentials are not configured
  try {
    if (!cachedTestTransporter) {
      const testAccount = await nodemailer.createTestAccount();
      cachedTestTransporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
      });
    }
    return { transporter: cachedTestTransporter, mode: "ethereal" };
  } catch {
    return {
      transporter: nodemailer.createTransport({ jsonTransport: true }),
      mode: "console",
    };
  }
}

export async function sendOtpEmail(params: {
  to: string;
  code: string;
  purpose: "REGISTER" | "RESET_PASSWORD";
}): Promise<{ mode: "smtp" | "ethereal" | "console"; previewUrl?: string }> {
  const { to, code, purpose } = params;
  const isReset = purpose === "RESET_PASSWORD";

  const subject = isReset
    ? "Zust Talk — Password Reset Verification Code"
    : "Zust Talk — Verify Your Email Address";

  const heading = isReset ? "Reset Your Password" : "Verify Your Email";
  const description = isReset
    ? "Use the verification code below to reset your Zust Talk password:"
    : "Enter this verification code in Zust Talk to verify your email and finish creating your account:";

  const html = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; background: #f8fafc; border-radius: 16px;">
      <div style="background: #ffffff; padding: 28px; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
        <div style="display: inline-block; padding: 10px 18px; border-radius: 12px; background: #059669; color: #ffffff; font-weight: bold; font-size: 16px; margin-bottom: 16px;">
          Zust Talk
        </div>
        <h2 style="margin: 0 0 8px; color: #0f172a; font-size: 20px;">${heading}</h2>
        <p style="margin: 0 0 22px; color: #475569; font-size: 14px; line-height: 1.5;">${description}</p>
        <div style="display: inline-block; padding: 14px 28px; background: #ecfdf5; border: 2px dashed #10b981; border-radius: 12px; font-size: 28px; font-weight: 800; letter-spacing: 6px; color: #047857;">
          ${code}
        </div>
        <p style="margin: 20px 0 0; color: #94a3b8; font-size: 12px;">
          This code expires in ${env.OTP_TTL_MINUTES} minutes. If you didn't request this, ignore this email.
        </p>
      </div>
    </div>
  `;

  try {
    const { transporter, mode } = await getTransporter();
    const from = env.SMTP_FROM || (env.SMTP_USER ? `Zust Talk <${env.SMTP_USER}>` : "Zust Talk <no-reply@zusttalk.local>");
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text: `${heading}: Your Zust Talk OTP code is ${code}. Valid for ${env.OTP_TTL_MINUTES} minutes.`,
      html,
    });

    const previewUrl = mode === "ethereal" ? nodemailer.getTestMessageUrl(info) || undefined : undefined;
    return { mode, previewUrl };
  } catch (err) {
    console.error("Failed to send OTP email:", err);
    return { mode: "console" };
  }
}
