export interface UserSessionOmit {
    userId: string;
    accessToken: string;
    refreshToken: string;
    otpNeeded: boolean;
    tenantId?: string | null;
    tenantUserId?: string | null;
    sessionExpiry: Date;
}

export default UserSessionOmit;