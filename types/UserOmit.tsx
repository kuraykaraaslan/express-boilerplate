class UserOmit {
    userId!: string;
    email!: string;
    phone?: string | null;
    name?: string | null;
    userRole!: string;
    createdAt?: Date;
    updatedAt?: Date;
    profilePicture?: string | null;
    otpEnabled!: boolean;
    otpEnabledAt!: Date | null;
}

export default UserOmit;