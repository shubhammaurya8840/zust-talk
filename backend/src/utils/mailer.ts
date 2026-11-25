import nodemailer from "nodemailer";
import { env } from "../config/env";

type MailTransporter = ReturnType<typeof nodemailer.createTransport>;
let cachedTestTransporter: MailTransporter | null = null;

export type EmailDeliveryResult = {
  mode: "webhook" | "brevo" | "resend" | "smtp" | "ethereal" | "console" | "failed";
  previewUrl?: string;
  error?: string;
};

function parseSender(): { name: string; email: string } {
  const raw = env.SMTP_FROM || env.SMTP_USER || "no-reply@zusttalk.local";
  const match = raw.match(/^(?:"?([^"<]+)"?\s*)?<([^>]+)>$/);
  if (match) {
    return {
      name: (match[1] || "Zust Talk").trim(),
      email: match[2].trim(),
    };
  }
  return { name: "Zust Talk", email: raw.trim() };
}

function buildOtpHtml(heading: string, description: string, code: string): string {
  return `
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
}

async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function sendViaWebhook(to: string, subject: string, text: string, html: string): Promise<EmailDeliveryResult> {
  const url = env.EMAIL_WEBHOOK_URL!.trim();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      subject,
      text,
      html,
      secret: env.EMAIL_WEBHOOK_SECRET || "",
    }),
    signal: AbortSignal.timeout(9000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Email webhook failed (${res.status}): ${errText.slice(0, 150)}`);
  }

  if (res.url && res.url.includes("accounts.google.com")) {
    throw new Error("Google Apps Script webhook is private. Deploy Web App with 'Who has access: Anyone'.");
  }

  const bodyText = await res.text().catch(() => "");
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText);
      if (parsed && parsed.ok === false) {
        throw new Error(parsed.error || "Email webhook returned ok:false");
      }
    } catch (e) {
      if (e instanceof Error && e.message !== "Unexpected end of JSON input" && !e.message.includes("JSON")) {
        throw e;
      }
    }
  }

  return { mode: "webhook" };
}

async function sendViaBrevo(to: string, subject: string, text: string, html: string): Promise<EmailDeliveryResult> {
  const sender = parseSender();
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.BREVO_API_KEY!.trim(),
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || `Brevo API error (${res.status})`);
  }

  return { mode: "brevo" };
}

async function sendViaResend(to: string, subject: string, text: string, html: string): Promise<EmailDeliveryResult> {
  const sender = parseSender();
  const fromHeader = env.SMTP_FROM || `${sender.name} <onboarding@resend.dev>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.RESEND_API_KEY!.trim()}`,
    },
    body: JSON.stringify({
      from: fromHeader,
      to: [to],
      subject,
      text,
      html,
    }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const errData = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(errData.message || `Resend API error (${res.status})`);
  }

  return { mode: "resend" };
}

async function sendViaSmtp(to: string, subject: string, text: string, html: string): Promise<EmailDeliveryResult> {
  const port = env.SMTP_PORT || 587;
  const secure = env.SMTP_SECURE === "true" || port === 465;

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: {
      user: env.SMTP_USER!,
      pass: env.SMTP_PASS!,
    },
    connectionTimeout: 5000,
    greetingTimeout: 4000,
    socketTimeout: 7000,
    dnsTimeout: 4000,
    family: 4,
  } as Parameters<typeof nodemailer.createTransport>[0]);

  const from = env.SMTP_FROM || `Zust Talk <${env.SMTP_USER}>`;
  await withTimeout(
    transporter.sendMail({ from, to, subject, text, html }),
    7000,
    "SMTP connection timed out. Note: Render Free tier blocks outbound SMTP ports 465/587 — set EMAIL_WEBHOOK_URL (Google Apps Script) or BREVO_API_KEY instead."
  );

  return { mode: "smtp" };
}

async function getDevTransporter(): Promise<{ transporter: MailTransporter; mode: "ethereal" | "console" }> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return {
      transporter: nodemailer.createTransport({ jsonTransport: true }),
      mode: "console",
    };
  }

  try {
    if (!cachedTestTransporter) {
      const testAccount = await withTimeout(nodemailer.createTestAccount(), 3500, "Ethereal timeout");
      cachedTestTransporter = nodemailer.createTransport({
        host: testAccount.smtp.host,
        port: testAccount.smtp.port,
        secure: testAccount.smtp.secure,
        auth: {
          user: testAccount.user,
          pass: testAccount.pass,
        },
        connectionTimeout: 4000,
        greetingTimeout: 4000,
        socketTimeout: 5000,
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
  purpose: "REGISTER" | "RESET_PASSWORD" | "VERIFY_EMAIL";
}): Promise<EmailDeliveryResult> {
  const { to, code, purpose } = params;
  const isReset = purpose === "RESET_PASSWORD";

  const subject = isReset
    ? "Zust Talk — Password Reset Verification Code"
    : "Zust Talk — Verify Your Email Address";

  const heading = isReset ? "Reset Your Password" : "Verify Your Email";
  const description = isReset
    ? "Use the verification code below to reset your Zust Talk password:"
    : "Enter this verification code in Zust Talk to verify your email and finish creating your account:";

  const text = `${heading}: Your Zust Talk OTP code is ${code}. Valid for ${env.OTP_TTL_MINUTES} minutes.`;
  const html = buildOtpHtml(heading, description, code);

  // 1. Google Apps Script HTTPS Webhook (free Gmail delivery over port 443, never blocked by Render)
  if (env.EMAIL_WEBHOOK_URL?.trim()) {
    try {
      return await sendViaWebhook(to, subject, text, html);
    } catch (err: any) {
      console.error("[Mailer] Webhook delivery failed:", err?.message || err);
      return { mode: "failed", error: err?.message || "Email webhook delivery failed." };
    }
  }

  // 2. Brevo HTTPS REST API (300 free emails/day over port 443)
  if (env.BREVO_API_KEY?.trim()) {
    try {
      return await sendViaBrevo(to, subject, text, html);
    } catch (err: any) {
      console.error("[Mailer] Brevo delivery failed:", err?.message || err);
      return { mode: "failed", error: err?.message || "Brevo email delivery failed." };
    }
  }

  // 3. Resend HTTPS REST API (port 443)
  if (env.RESEND_API_KEY?.trim()) {
    try {
      return await sendViaResend(to, subject, text, html);
    } catch (err: any) {
      console.error("[Mailer] Resend delivery failed:", err?.message || err);
      return { mode: "failed", error: err?.message || "Resend email delivery failed." };
    }
  }

  // 4. Traditional SMTP (may be blocked on Render free tier ports 465/587)
  if (env.SMTP_USER && env.SMTP_PASS) {
    try {
      return await sendViaSmtp(to, subject, text, html);
    } catch (err: any) {
      console.error("[Mailer] SMTP delivery failed:", err?.message || err);
      return {
        mode: "failed",
        error:
          err?.message ||
          "SMTP delivery failed. Note: Render Free tier blocks outbound SMTP ports 465/587 — use EMAIL_WEBHOOK_URL or BREVO_API_KEY.",
      };
    }
  }

  // 5. No email provider configured: Ethereal / console dev fallback
  try {
    const { transporter, mode } = await getDevTransporter();
    const from = env.SMTP_FROM || "Zust Talk <no-reply@zusttalk.local>";
    const info = await withTimeout(
      transporter.sendMail({ from, to, subject, text, html }),
      4000,
      "Dev mail timeout"
    );
    const previewUrl = mode === "ethereal" ? nodemailer.getTestMessageUrl(info) || undefined : undefined;
    return { mode, previewUrl };
  } catch {
    return { mode: "console" };
  }
}
