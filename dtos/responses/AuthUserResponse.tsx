interface AuthUserResponse {
    userId: string;
    email: string;
    phone: string | null;
    name: string | null;
    role: string;
    createdAt: Date;
    updatedAt: Date;
    profilePicture: string | null;
    otpEnabled: boolean;
    otpEnabledAt: Date | null;
}

export default AuthUserResponse;