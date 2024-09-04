const EmailChangeMailTemplate = (props: { email: string; code: string }) => {
  const { email, code } = props;
  const url =
    process.env.FRONTEND_URL + `/auth/change-email?email=${email}&code=${code}`;
  const mailBody = `<div>
        <p>Hi,</p>
        <p>You have requested to change your email address for ${process.env.APP_NAME}.</p>
        <p>Your email change code is: ${code}</p>
        <p>Click the link below to change your email address:</p>
        <a href="${url}">${url}</a>
        <p>Thank you!</p>
        </div>
        <p>If you did not request to change your email address for ${process.env.APP_NAME}, please ignore this email.</p>`;

  return mailBody;
};

export default EmailChangeMailTemplate;
