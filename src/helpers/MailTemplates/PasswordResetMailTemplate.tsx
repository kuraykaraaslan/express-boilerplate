const PasswordResetMailTemplate = (props: { email: string; code: string }) => {
  const { email, code } = props;

  const url =
    process.env.FRONTEND_URL +
    `/auth/reset-password?email=${email}&code=${code}`;

  const mailBody = `<div>
        <p>Hi,</p>
        <p>You have requested to reset your password for ${process.env.APP_NAME}.</p>
        <p>Your password reset code is: ${code}</p>
        <p>Click the link below to reset your password:</p>
        <a href="${url}">${url}</a>
        <p>Thank you!</p>
        </div>
        <p>If you did not request to reset your password for ${process.env.APP_NAME}, please ignore this email.</p>`;
  return mailBody;
};

export default PasswordResetMailTemplate;
