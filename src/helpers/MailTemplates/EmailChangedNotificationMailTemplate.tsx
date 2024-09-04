const EmailChangedNotificationMailTemplate = (props: {
  targetEmail: string;
  newEmail: string;
}) => {
  const { targetEmail, newEmail } = props;

  const mailBody = `<div>
        <p>Hi,</p>
        <p>Your email address ${targetEmail} has been changed to ${newEmail}.</p>
        <p>If you did not make this change, please contact us immediately.</p>
        <a href="mailto:${process.env.APP_SUPPORT_EMAIL}">${process.env.APP_SUPPORT_EMAIL}</a>
        <p>Thank you!</p>
        </div>`;

  return mailBody;
};

export default EmailChangedNotificationMailTemplate;
