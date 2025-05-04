export interface UserSessionOmit {
    userSessionId: string;
    userId: string;
    otpNeeded: boolean;
    tenantUserId: string | null;
    sessionExpiry: Date;
}

export default UserSessionOmit;