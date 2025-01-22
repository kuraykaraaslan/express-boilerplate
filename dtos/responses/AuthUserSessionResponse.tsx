interface AuthUserSessionResponse {
    sessionId: string;
    userId: string;
    sessionToken: string;
    sessionExpiry: Date;
    sessionAgent: string;
    otpNeeded: boolean;
}

export default AuthUserSessionResponse;