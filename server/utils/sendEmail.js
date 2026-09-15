const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const sendPasswordResetEmail = async ({ to, resetUrl }) => {
  return sendEmail({
    to, subject: 'Reset your Smartrack password',
    html: `<p>A password reset was requested for your Smartrack account.</p><p><a href="${resetUrl}">Reset your password</a></p><p>This link expires in 30 minutes. If you did not request it, you can ignore this email.</p>`,
  });
};

export const sendEmail = async ({ to, subject, html, attachments = [] }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error('Email service is not configured.');

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      attachments: attachments.map(attachment => ({
        filename: attachment.filename,
        content: Buffer.isBuffer(attachment.content)
          ? attachment.content.toString('base64')
          : attachment.content,
      })),
    }),
  });

  if (!response.ok) throw new Error(`Email service rejected the request (${response.status}).`);
};

export const sendAccountStatusEmail = ({ to, status }) => sendEmail({
  to,
  subject: status === 'approved' ? 'Your Smartrack registration was approved' : 'Your Smartrack account status changed',
  html: status === 'approved'
    ? '<p>Your Smartrack registration has been approved. You can now sign in using the password you created.</p>'
    : status === 'rejected'
      ? '<p>Your Smartrack registration was not approved. Contact your coordinator if you believe this was a mistake.</p>'
      : '<p>Your Smartrack account has been deactivated. Contact your coordinator if you need help.</p>',
});
