const InviteUserTemplate = (props: { tenantName: string; email: string; code: string }) => {
    const { tenantName, email, code } = props;

    const url = process.env.FRONTEND_URL + `/auth/invite?email=${email}&code=${code}`;

    const mailBody = `<div>
        <p>Hi,</p>
        <p>You have been invited to join ${tenantName} on ${process.env.APP_NAME}!</p>
        <p>Your invitation code is: ${code}</p>
        <p>Please click the link below to accept the invitation:</p>
        <a href="${url}">${url}</a>
        <p>Thank you!</p>
        <p
        </div>
        <p>If you did not sign up for ${process.env.APP_NAME}, please ignore this email.</p>`;
    return mailBody;
}

export default InviteUserTemplate;