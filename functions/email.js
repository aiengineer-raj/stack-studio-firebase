/**
 * OTP email delivery, via Resend -- the same service the earlier backend
 * used. Reusing it rather than introducing a second email provider for no
 * reason.
 *
 * The API key is a genuine secret and must NEVER appear in any file the
 * browser loads (unlike the Firebase web config, which is meant to be
 * public). It is read from Cloud Functions environment config, set once via
 * the CLI -- see SETUP.md -- never hardcoded here.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * Sends the OTP. Throws on failure -- the caller decides what that means
 * for the client-facing response (see index.js: a failed send must not
 * silently report success).
 */
async function sendOtpEmail({ apiKey, fromAddress, toEmail, otp }) {
  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toEmail],
      subject: 'Your Stack Studio sign-in code',
      text:
        'Your sign-in code is ' + otp + '\n\n' +
        'It expires in 5 minutes and can be used once.\n\n' +
        "If you didn't request this, you can ignore this email — " +
        'no one can sign in without also having access to this inbox.',
      html:
        '<p>Your sign-in code is:</p>' +
        '<p style="font-size:28px;font-weight:700;letter-spacing:4px;">' + otp + '</p>' +
        '<p>It expires in 5 minutes and can be used once.</p>' +
        "<p style=\"color:#666;font-size:13px;\">If you didn't request this, " +
        'you can ignore this email — no one can sign in without also having ' +
        'access to this inbox.</p>',
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Email send failed (' + res.status + '): ' + body);
  }
}

module.exports = { sendOtpEmail };
