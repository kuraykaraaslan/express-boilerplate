const OTPMailTemplate = (props: { email: string, code: string }) => {
    const { email, code } = props;

    const mailBody = `<div>
        <p>Hi,  ${email.split('@')[0]}</p>
        <p>Your OTP code is: ${code}</p>
        <p>Thank you!</p>
        </div>`;
    return mailBody;
}

export default OTPMailTemplate;