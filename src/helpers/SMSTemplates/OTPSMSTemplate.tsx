const OTPSMSTemplate = (props : { code: string }) => {
    const { code } = props;
    const smsBody = `Your verification code is: ${code} \n Do not share this code with anyone.`;
    return smsBody;
}

export default OTPSMSTemplate;