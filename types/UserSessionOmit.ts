export interface UserSessionOmit {
    sessionId: string;
    userId: string;
    otpNeeded: boolean;
    tenantId: string | null;
    tenantUserId: string | null;
    sessionExpiry: Date;
}

export default UserSessionOmit;