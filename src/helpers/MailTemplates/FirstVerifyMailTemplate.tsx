const FirstVerifyMailTemplate = (props: { email: string, code: string }) =>  {
   
    const {  email, code } = props;

    const url = process.env.FRONTEND_URL + `/auth/verify-first?email=${email}&code=${code}`;
    

    const mailBody = `<div>
    <p>Hi,</p>
    <p>Thank you for signing up with ${process.env.APP_NAME}!</p>
    <p>Your verification code is: ${code}</p>
    <p>Please click the link below to verify your email address:</p>
    <a href="${url}">${url}</a>
    <p>Thank you!</p>
    <p
    </div>
    <p>If you did not sign up for ${process.env.APP_NAME}, please ignore this email.</p>`;
    return mailBody;
}


export default FirstVerifyMailTemplate;

