export interface UserSessionOmit {
    sessionId: string;
    userId: string;
    otpNeeded: boolean;
    tenantUserId: string | null;
    sessionExpiry: Date;
}

export default UserSessionOmit;