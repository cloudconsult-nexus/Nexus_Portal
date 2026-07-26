import nodemailer from 'nodemailer';

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

// No SMTP_HOST configured (e.g. local dev, or a test environment that
// doesn't need real delivery) — log instead of sending. RUNBOOK.md's
// "Email not sending" section greps logs for this exact prefix.
export async function sendEmail({ to, subject, html }) {
  if (!process.env.SMTP_HOST) {
    console.log(`[email:dev] would send to ${to}: ${subject}`);
    return { delivered: false };
  }

  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || 'no-reply@example.com',
    to,
    subject,
    html,
  });
  return { delivered: true };
}
