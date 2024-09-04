const PhoneChangedSMSNotifcationTemplate = (props: { targetPhone: string , newPhone: string }) => {
    const { newPhone } = props;
    const smsBody = `Your phone number has been changed to ${newPhone}. If you did not make this change, please contact us immediately.`;
    return smsBody;
}

export default PhoneChangedSMSNotifcationTemplate;