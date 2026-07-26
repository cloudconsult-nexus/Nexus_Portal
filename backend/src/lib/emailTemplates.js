export function inviteEmail({ name, acceptUrl, orgName }) {
  return {
    subject: `You've been invited to OnCall Pro${orgName ? ` — ${orgName}` : ''}`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>You've been invited to join OnCall Pro${orgName ? ` for <strong>${escapeHtml(orgName)}</strong>` : ''}.</p>
      <p><a href="${acceptUrl}">Accept your invitation</a></p>
      <p>This link expires in 7 days.</p>
    `,
  };
}

export function passwordResetEmail({ name, resetUrl }) {
  return {
    subject: 'Reset your OnCall Pro password',
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Click below to reset your password. If you didn't request this, you can ignore this email.</p>
      <p><a href="${resetUrl}">Reset your password</a></p>
      <p>This link expires in 1 hour.</p>
    `,
  };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
