export function inviteEmail({ name, acceptUrl, orgName, productName }) {
  return {
    subject: `You've been invited to ${productName}${orgName ? ` — ${orgName}` : ''}`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>You've been invited to join ${escapeHtml(productName)}${orgName ? ` for <strong>${escapeHtml(orgName)}</strong>` : ''}.</p>
      <p><a href="${acceptUrl}">Accept your invitation</a></p>
      <p>This link expires in 7 days.</p>
    `,
  };
}

export function passwordResetEmail({ name, resetUrl, productName }) {
  return {
    subject: `Reset your ${productName} password`,
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
