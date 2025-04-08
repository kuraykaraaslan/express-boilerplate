export interface UserSessionOmit {
    accessToken: string;
    refreshToken: string;
    otpNeeded: boolean;
}

export default UserSessionOmit;