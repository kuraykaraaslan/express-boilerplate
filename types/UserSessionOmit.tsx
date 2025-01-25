class UserSessionOmit {
    sessionId!: string;
    userId!: string;
    sessionToken!: string;
    sessionExpiry!: Date;
    sessionAgent!: string;
    otpNeeded!: boolean;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    ip?: string | null;
    device?: string | null;
    createdAt?: Date;
}

export default UserSessionOmit;