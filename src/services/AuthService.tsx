import { User, Session, PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import SendMail from '../helpers/SendMail';
import Logger from '../helpers/Logger';

const prisma = new PrismaClient();

export default class AuthService {

    /* Validaters */

    static validateEmail(email: string): void {
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
            throw new Error('INVALID_EMAIL');
        }
    }

    static validatePassword(password: string | null): void {

        // Allow empty password for password reset
        if (!password) {
            return;
        }

        if (password.length < 8) {
            throw new Error('PASSWORD_TOO_SHORT');
        }

        if (password.length > 50) {
            throw new Error('PASSWORD_TOO_LONG');
        }

        /* 
            Password must contain at least one uppercase letter, one lowercase letter, one digit, and one special character.
            Password must not contain any whitespace.
            No SQL injection.
            Allow Turkish characters.
        */
        const passwordRegex = /^(?=.*[a-zçğıöşü])(?=.*[A-ZÇĞİÖŞÜ])(?=.*\d)(?=.*[@$!%*?&])[A-Za-zçğıöşüÖÇŞİĞÜ0-9@$!%*?&]{8,50}$/;

        if (!passwordRegex.test(password)) {
            throw new Error('INVALID_PASSWORD');
        }

    }

    static validateStringField(field: string | null, field_name: string, allowEmpty: boolean = false): void {
        /*
            No SQL injection.
            Allow Turkish characters.
        */

        if (allowEmpty && !field) {
            return;
        }

        if (!field && !allowEmpty) {
            throw new Error(`EMPTY_${field_name.toUpperCase()}`);
        }


        if (field && field.length < 2) {
            if (field_name) {
                throw new Error(`INVALID_${field_name.toUpperCase()}`);
            }
            throw new Error('INVALID_STRING_FIELD');
        }

        const stringFieldRegex = /^[a-zA-ZçğıöşüÇĞİÖŞÜ\s]*$/;

        if (!stringFieldRegex.test('string')) {
            if (field_name) {
                throw new Error(`INVALID_${field_name.toUpperCase()}`);
            }
            throw new Error('INVALID_STRING_FIELD');
        }

    }

    static validatePhone(phone: number | null): void {
        // Allow empty phone for phone verification
        if (!phone) {
            return;
        }
        //starts with + and has numbers only
        const phoneRegex = /^\+[0-9]+$/;
        if (!phoneRegex.test(phone.toString())) {
            throw new Error('INVALID_PHONE');
        }

    }

    static async rateLimiterEmail(user: User): Promise<void> {
        if (user.lastEmailSent && new Date(user.lastEmailSent) > new Date(Date.now() - 1000 * 60 * 2))
        {
            throw new Error('EMAIL_RATE_LIMIT');
        }

        await prisma.user.update({
            where: {
                userId: user.userId
            },
            data: {
                lastEmailSent: new Date()
            }
        });
    }

    static async rateLimiterPhone(user: User): Promise<void> {
        if (user.lastPhoneSent && new Date(user.lastPhoneSent) > new Date(Date.now() - 1000 * 60 * 5))
        {
            throw new Error('PHONE_RATE_LIMIT');
        }

        await prisma.user.update({
            where: {
                userId: user.userId
            },
            data: {
                lastPhoneSent: new Date()
            }
        });
    }

    static checkIfUserIsVerified(user: User): void {
        if (!user.verified) {

            this.sendFirstVerificationEmail(user.userId);

            if (process.env.NODE_ENV === 'development') {
                return;
            }

            throw new Error('USER_NOT_VERIFIED');
        }
    }

    /* Hashers */
    static async hashPassword(password: string): Promise<string> {
        const saltRounds = 10;
        return await bcrypt.hash(password, saltRounds);
    }

    /* Comparators */
    static async comparePassword(plainPassword: string, hashedPassword?: string | null): Promise<void> {
        if (!hashedPassword) {
            throw new Error('USER_HAS_NO_PASSWORD');
        }
        const isPasswordCorrect = await bcrypt.compare(plainPassword, hashedPassword);

        if (!isPasswordCorrect) {
            throw new Error('WRONG_PASSWORD');
        }
    }

    /* Finders */
    static async findUserByEmail(email: string): Promise<User | null> {
        return await prisma.user.findUnique({
            where: {
                email: email
            }
        });
    }

    static async findUserByPhone(phone: number): Promise<User | null> {
        return await prisma.user.findUnique({
            where: {
                phone: phone
            }
        });
    }

    /* Creators */

    static async createSession(userId: string): Promise<Session> {
        const token = bcrypt.hashSync(Math.random().toString(36).substring(7), 10);

        const session = await prisma.session.create({
            data: {
                userId: userId,
                token: token,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) // 1 week
            }
        });

        return session;
    }


    static async createUser(email: string, password: string): Promise<any> {

        this.validateEmail(email);
        this.validatePassword(password);

        const existingUser = await this.findUserByEmail(email);
        if (existingUser) {
            throw new Error('USER_ALREADY_EXISTS');
        }

        const hashedPassword = await this.hashPassword(password);

        const user = await prisma.user.create({
            data: {
                email: email,
                password: hashedPassword
            }
        });

        return {
            userId: user.userId,
            email: user.email,
            phone: user.phone,
            name: user.name,
            verified: user.verified
        };

    }

    static async login(email: string, password: string): Promise<any> {

        this.validateEmail(email);
        this.validatePassword(password);

        const user = await this.findUserByEmail(email);
        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        this.checkIfUserIsVerified(user);

        await this.comparePassword(password, user.password);

        const session = await this.createSession(user.userId);

        // update user last login
        await prisma.user.update({
            where: {
                userId: user.userId
            },
            data: {
                lastLogin: new Date()
            }
        });

        return {
            token: session.token,
            user: {
                userId: user.userId,
                email: user.email,
                phone: user.phone,
                name: user.name,
                verified: user.verified
            }
        };


    }

    static async getUserFromTokenAndExtendAday(token: string): Promise<any> {

        const session = await prisma.session.update({
            where: {
                token: token,
                expiresAt: {
                    gt: new Date()
                }
            },
            data: {
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24)
            },
            select: {
                token: true,
                user: {
                    select: {
                        userId: true,
                        name: true,
                        email: true,
                        phone: true,
                        verified: true,
                        roles: true,
                        language: true,
                        theme: true,
                    }
                },
                expiresAt: true,
                OTPNeeded: true
            }
        }).catch((e) => {
            return null;
        });

        if (!session) {
            return null;
        }

        return session;

    }

    /* Verifiers */
    static async sendFirstVerificationEmail(userId: string): Promise<void> {
        //TODO

        const user = await prisma.user.findUnique({
            where: {
                userId: userId
            }
        });

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        if (user.verified) {
            throw new Error('USER_ALREADY_VERIFIED');
        }

        this.rateLimiterEmail(user);

        const verificationToken = Math.floor(100000 + Math.random() * 900000).toString();

        Logger.info(`Verification token for ${user.email}: ${verificationToken}`);

        await prisma.user.update({
            where: {
                userId: userId
            },
            data: {
                verificationToken: verificationToken
            }
        });


        SendMail.sendFirstVerifyMail(user.email, verificationToken);


    }

    static async verifyFirstVerificationEmail(email: string, code: string): Promise<void> {

        this.validateEmail(email);

        const user = await this.findUserByEmail(email);

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        if (user.verified) {
            throw new Error('USER_ALREADY_VERIFIED');
        }

        if (user.verificationToken !== code) {
            throw new Error('INVALID_VERIFICATION_CODE');
        }

        if (typeof user.verificationTokenExpires === 'undefined' || user.verificationTokenExpires === null) {
            throw new Error('VERIFICATION_CODE_EXPIRED');
        }

        if (new Date(user.verificationTokenExpires) < new Date()) {
            throw new Error('VERIFICATION_CODE_EXPIRED');
        }

        await prisma.user.update({
            where: {
                userId: user.userId
            },
            data: {
                verified: true,
                verificationToken: null,
                verificationTokenExpires: null
            }
        });

    }

    static async sendPasswordResetEmail(userId: string): Promise<void> {

        const user = await prisma.user.findUnique({
            where: {
                userId: userId
            }
        });

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        this.rateLimiterEmail(user);

        const resetToken = Math.floor(100000 + Math.random() * 900000).toString();

        Logger.info(`Reset token for ${user.email}: ${resetToken}`);

        await prisma.user.update({
            where: {
                userId: userId
            },
            data: {
                passwordResetToken: resetToken,
                passwordResetTokenExpires: new Date(Date.now() + 1000 * 60 * 15) // 15 minutes
            }
        });

        SendMail.sendPasswordResetMail(user.email, resetToken);
    }

    static async verifyPasswordResetEmailAndChangePassword(email: string, code: string, password: string): Promise<void> {

        this.validateEmail(email);
        this.validatePassword(password);

        const user = await this.findUserByEmail(email);

        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }

        if (user.passwordResetToken !== code) {
            throw new Error('INVALID_RESET_CODE');
        }

        if (typeof user.passwordResetTokenExpires === 'undefined' || user.passwordResetTokenExpires === null) {
            throw new Error('RESET_CODE_EXPIRED');
        }

        if (new Date(user.passwordResetTokenExpires) < new Date()) {
            throw new Error('RESET_CODE_EXPIRED');
        }

        const hashedPassword = await this.hashPassword(password);

        await prisma.user.update({
            where: {
                userId: user.userId
            },
            data: {
                password: hashedPassword,
                passwordResetToken: null,
                passwordResetTokenExpires: null
            }
        });

    }


    static async sendOTPEmail(sessionToken: string): Promise<void> {

        /*
        - Session Will not verify at this point
        - We will only send OTP to the email
        - Be sure to check if the session the previous step is verified
        */

        const session = await prisma.session.findUnique({
            where: {
                token: sessionToken
            },
            select: {
                user: {
                    select: {
                        email: true,
                        phone: true,
                        userId: true
                    }
                }
            }
        });

        if (!session) {
            throw new Error('SESSION_NOT_FOUND');
        }

        this.rateLimiterEmail(session.user as User);

        const OTP = Math.floor(100000 + Math.random() * 900000).toString();

        Logger.info(`OTP for ${session.user.email}: ${OTP}`);

        await prisma.session.update({
            where: {
                token: sessionToken
            },
            data: {
                OTPVerificationEmailCode: OTP,
                OTPVerificationEmailCodeExpires: new Date(Date.now() + 1000 * 60 * 15) // 15 minutes
            }
        });

        SendMail.sendOTPMail(session.user.email, OTP);
    }

    static async verifyOTPEmail(sessionToken: string, code: string): Promise<void> {

        const session = await prisma.session.findUnique({
            where: {
                token: sessionToken,
                OTPVerificationEmailCode: code,
                OTPVerificationEmailCodeExpires: {
                    gt: new Date()
                }
            },
            select: {
                OTPVerificationEmailCode: true,
                OTPVerificationEmailCodeExpires: true
            }
        });

        if (!session) {
            throw new Error('INVALID_OTP');
        }

        await prisma.session.update({
            where: {
                token: sessionToken
            },
            data: {
                OTPNeeded: false,
                OTPVerificationEmailCode: null,
                OTPVerificationEmailCodeExpires: null
            }
        });

    }

    
}

