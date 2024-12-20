import { User, Session, PrismaClient, Tenant } from "@prisma/client";
import bcrypt from "bcrypt";

import SendMail from "../helpers/SendMail";
import SendSMS from "../helpers/SendSMS";
import Validater from "../helpers/Validater";

import Logger from "../helpers/Logger";

import axios from "axios";
import Request from "../request/Request";
import NotificationService from "./NotificationService";

const prisma = new PrismaClient();

export default class AuthService {

  static async WriteSessionParametersfromRequest(session: Session, req: Request): Promise<void> {
    // ip , os, browser, device, platform

    console.log(req.headers);

    var ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    
    if (process.env.NODE_ENV === "development") {
    ip = (ip === "::1") ? "85.111.49.176" : ip; // Using Turk Telekom IP for local testing
    }

    var os = "Unknown OS";
    var browser = "Unknown Browser";
    var device = "Unknown Device";

    const knownOS = ["Windows", "Mac", "Linux", "Android", "iOS"];
    const knownBrowsers = ["Firefox", "Chrome", "Safari", "Edge", "Opera", "PostmanRuntime"];


    const userAgent = req.headers["user-agent"] ? req.headers["user-agent"] : "";

    knownOS.forEach((os) => {
      if (userAgent.includes(os)) {
        os = os;
      }
    });

    knownBrowsers.forEach((browser) => {
      if (userAgent.includes(browser)) {
        browser = browser;
      }
    });
    
    switch (os) {
      case "Windows":
        if (userAgent.includes("Windows Phone")) {
          device = "Windows Phone";
        } else {
          device = "Windows PC";
        }
        break;
      case "Mac":
        device = "Mac";
        break;
      case "Linux":
        device = "Linux";
        break;
      case "Android":
        device = "Android";
        break;
      case "iOS":
        device = "iOS";
        break;
      default:
        if (browser === "PostmanRuntime") {
          device = "Postman";
        } else {
          device = "Unknown Device";
        }
      break; 
    }

    var region = "Unknown Region";
    var city = "Unknown City";
    var country = "Unknown Country";
    var isp = "Unknown ISP";

    try {
      const url = "https://ipapi.co/" + ip + "/json/";
      console.log(url);
      const response = await axios.get(url);

      console.log(response.data);
     
      region = response.data.region ? response.data.region : "Unknown Region";
      country = response.data.country_name ? response.data.country_name : "Unknown Country";
      city = response.data.city ? response.data.city : "Unknown City";
      isp = response.data.org ? response.data.org : "Unknown ISP";
    }
    catch (error) {
      console.log(error);
    }

    await prisma.session.update({
      where: {
        token: session.token,
      },
      data: {
        ip: ip ? ip.toString() : "Unknown IP",
        os: os ? os : "Unknown OS",
        browser: browser ? browser : "Unknown Browser",
        device: device ? device : "Unknown Device",
        region: region ? region : "Unknown Region",
        city: city ? city : "Unknown City",
        country: country ? country : "Unknown Country",
        isp: isp ? isp : "Unknown ISP",
      },
    });

  }

  static async rateLimiterEmail(user: User): Promise<void> {

    if (
      user.lastEmailSent &&
      new Date(user.lastEmailSent) > new Date(Date.now() - 1000 * 60 * 2)
    ) {
      throw new Error("EMAIL_RATE_LIMIT");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        lastEmailSent: new Date(),
      },
    });
  }

  static async rateLimiterPhone(user: User): Promise<void> {
    if (
      user.lastPhoneSent &&
      new Date(user.lastPhoneSent) > new Date(Date.now() - 1000 * 60 * 5)
    ) {
      throw new Error("PHONE_RATE_LIMIT");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        lastPhoneSent: new Date(),
      },
    });
  }

  static checkIfUserIsVerified(user: User): void {
    if (!user.verified) {
      this.sendFirstVerificationEmail(user);

      if (process.env.NODE_ENV === "development") {
        return;
      }

      throw new Error("USER_NOT_VERIFIED");
    }
  }

  /* Hashers */
  static async hashPassword(password: string): Promise<string> {

    Validater.validatePassword(password);

    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  }

  /* Comparators */
  static async comparePassword(
    plainPassword: string,
    hashedPassword?: string | null,
  ): Promise<void> {
    if (!hashedPassword) {
      throw new Error("USER_HAS_NO_PASSWORD");
    }

    Validater.validatePassword(plainPassword);

    const isPasswordCorrect = await bcrypt.compare(
      plainPassword,
      hashedPassword,
    );

    if (!isPasswordCorrect) {
      throw new Error("WRONG_PASSWORD");
    }
  }

  /* Finders */
  static async findUserByEmail(email: string): Promise<User | null> {

    Validater.validateEmail(email);

    return await prisma.user.findUnique({
      where: {
        email: email,
      },
    });
  }

  static async findUserByPhone(phone: number): Promise<User | null> {

    Validater.validatePhone(phone);

    return await prisma.user.findUnique({
      where: {
        phone: phone,
      },
    });
  }

  /* Creators */

  static async createSession(user: User, byOAuth: boolean = false, tenant: Tenant | null = null): Promise<Session> {

    const token = bcrypt.hashSync(Math.random().toString(36).substring(7), 10);

    const session = await prisma.session.create({
      data: {
        userId: user.userId,
        token: token,
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7), // 1 week
        OTPNeeded: byOAuth ? false : user.OTPEnabled,
        OTPCanUseEmail: user.OTPCanUseEmail,
        OTPCanUsePhone: user.OTPCanUsePhone,
      },
    });

    return session;
  }

  static async createUser(email: string, password: string): Promise<any> {

    Validater.validateEmail(email);
    Validater.validatePassword(password);

    const existingUser = await this.findUserByEmail(email);
    if (existingUser) {
      throw new Error("USER_ALREADY_EXISTS");
    }

    const hashedPassword = await this.hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: email,
        password: hashedPassword,
      },
    });

    return {
      userId: user.userId,
      email: user.email,
      phone: user.phone,
      name: user.name,
      verified: user.verified,
    };
  }

  static async login(email: string, password: string, req: Request): Promise<any> {

    Validater.validateEmail(email);
    Validater.validatePassword(password);

    Logger.info(`Login attempt for ${email}`);

    const user = await this.findUserByEmail(email);
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    this.checkIfUserIsVerified(user);

    await this.comparePassword(password, user.password);


    const session = await this.createSession(user);

    // write session parameters like ip, os, browser, device, platform
    await this.WriteSessionParametersfromRequest(session, req);

    const ip = req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    // update user last login
    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        lastLogin: new Date(),
        lastLoginIP: ip ? ip.toString() : "Unknown IP",
      },
    });

    Logger.info(`Login success for ${email}`);
    NotificationService.createLoginNotification(user);

    return {
      token: session.token,
      OTP: {
        OTPNeeded: session.OTPNeeded,
        OTPCanUseEmail: session.OTPCanUseEmail,
        OTPCanUsePhone: session.OTPCanUsePhone,
      },
      user: {
        userId: user.userId,
        email: user.email,
        phone: user.phone,
        name: user.name,
        verified: user.verified,
        roles: user.roles,
        language: user.language,
        theme: user.theme,
        avatar: user.avatar,
      },
    };
  }

  static async getSessionFromBearerToken(token?: string): Promise<any> {

    // Check if token is present
    if (!token || token.length < 7) {
      Logger.error("[AUTH SERVICE] Token not present");
      return null;
    }

    // Check if token is valid
    const tokenWithoutBearer = token.substring(7);

    Validater.validateToken(tokenWithoutBearer);

    const sessionWithUser =
      await AuthService.getSessionFromTokenAndExtendAday(tokenWithoutBearer);
    return sessionWithUser;
  }

  static async getSessionFromTokenAndExtendAday(token: string): Promise<any> {
    const session = await prisma.session
      .update({
        where: {
          token: token,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: {
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
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
              avatar: true,
              OTPEnabled: true,
              OTPCanUseEmail: true,
              OTPCanUsePhone: true,
              lastLogin: true,
            },
          },
          expiresAt: true,
          OTPNeeded: true,
        },
      })
      .catch((error) => {
        return null;
      });

    if (!session) {
      return null;
    }

    return session;
  }

  static async logout(token: string): Promise<void> {
    // Check if token is present
    if (!token || token.length < 7) {
      throw new Error("TOKEN_NOT_PRESENT");
    }

    // Check if token is valid
    const tokenWithoutBearer = token.substring(7);

    Validater.validateToken(tokenWithoutBearer);

    // Check if token is valid
    const session = await prisma.session.findUnique({
      where: {
        token: tokenWithoutBearer,
      },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    await prisma.session.delete({
      where: {
        token: tokenWithoutBearer,
      },
    });

    Logger.info(`Logout success for ${session.token}`);
  }



  /* Verifiers */
  static async sendFirstVerificationEmail(user: User): Promise<void> {
    //TODO
    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.verified) {
      throw new Error("USER_ALREADY_VERIFIED");
    }

    await this.rateLimiterEmail(user);

    const verificationToken = Math.floor(
      100000 + Math.random() * 900000,
    ).toString();

    Logger.info(`Verification token for ${user.email}: ${verificationToken}`);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        verificationToken: verificationToken,
        verificationTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
      },
    });

    await SendMail.sendFirstVerifyMail(user.email, verificationToken);
  }

  static async sendFirstVerificationEmailByEmail(email: string): Promise<void> {

    Validater.validateEmail(email);

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    await this.sendFirstVerificationEmail(user);
  }

  static async verifyFirstVerificationEmail(
    email: string,
    code: string,
  ): Promise<void> {

    Validater.validateEmail(email);
    Validater.validateSixDigitCode(code);

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.verified) {
      throw new Error("USER_ALREADY_VERIFIED");
    }

    if (user.verificationToken !== code) {
      throw new Error("INVALID_VERIFICATION_CODE");
    }

    if (
      typeof user.verificationTokenExpires === "undefined" ||
      user.verificationTokenExpires === null
    ) {
      throw new Error("VERIFICATION_CODE_EXPIRED");
    }

    if (new Date(user.verificationTokenExpires) < new Date()) {
      throw new Error("VERIFICATION_CODE_EXPIRED");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        verified: true,
        verificationToken: null,
        verificationTokenExpires: null,
      },
    });
  }

  static async sendPasswordResetEmail(user: User): Promise<void> {

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    /*
        await this.rateLimiterEmail(user);
    */

    const resetToken = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`Reset token for ${user.email}: ${resetToken}`);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        passwordResetToken: resetToken,
        passwordResetTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
      },
    });

    SendMail.sendPasswordResetMail(user.email, resetToken);
  }

  static async verifyPasswordResetEmailAndChangePassword(
    email: string,
    code: string,
    password: string,
  ): Promise<void> {

    Validater.validateEmail(email);
    Validater.validatePassword(password);
    Validater.validateSixDigitCode(code);

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.passwordResetToken !== code) {
      throw new Error("INVALID_RESET_CODE");
    }

    if (
      typeof user.passwordResetTokenExpires === "undefined" ||
      user.passwordResetTokenExpires === null
    ) {
      throw new Error("RESET_CODE_EXPIRED");
    }

    if (new Date(user.passwordResetTokenExpires) < new Date()) {
      throw new Error("RESET_CODE_EXPIRED");
    }

    const hashedPassword = await this.hashPassword(password);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetTokenExpires: null,
      },
    });
  }

  static async sendOTPEmail(sessionToken: string): Promise<void> {
    /*
        - Session Will not verify at this point
        - We will only send OTP to the email
        - Be sure to check if the session the previous step is verified
        */
    Validater.validateToken(sessionToken);

    const session = await prisma.session.findUnique({
      where: {
        token: sessionToken,
      },
      select: {
        user: {
          select: {
            email: true,
            phone: true,
            userId: true,
            OTPEnabled: true,
            OTPCanUseEmail: true,
            lastEmailSent: true,
            lastPhoneSent: true,
          },
        },
        OTPNeeded: true,
      },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    if (!session.user.OTPEnabled) {
      throw new Error("OTP_NOT_ENABLED");
    }

    if (!session.user.OTPCanUseEmail) {
      throw new Error("OTP_CANNOT_USE_EMAIL");
    }

    if (!session.OTPNeeded) {
      throw new Error("OTP_NOT_NEEDED");
    }

    await this.rateLimiterEmail(session.user as User);

    const OTP = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`OTP for ${session.user.email}: ${OTP}`);

    await prisma.session.update({
      where: {
        token: sessionToken,
      },
      data: {
        OTPVerificationEmailCode: OTP,
        OTPVerificationEmailCodeExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
      },
    });

    SendMail.sendOTPMail(session.user.email, OTP);
  }

  static async verifyOTPEmail(
    sessionToken: string,
    code: string,
  ): Promise<void> {

    Validater.validateToken(sessionToken);
    Validater.validateSixDigitCode(code);

    const session = await prisma.session.findUnique({
      where: {
        token: sessionToken,
        OTPVerificationEmailCode: code,
        OTPVerificationEmailCodeExpires: {
          gt: new Date(),
        },
      },
      select: {
        OTPVerificationEmailCode: true,
        OTPVerificationEmailCodeExpires: true,
      },
    });

    if (!session) {
      throw new Error("INVALID_OTP");
    }

    await prisma.session.update({
      where: {
        token: sessionToken,
      },
      data: {
        OTPNeeded: false,
        OTPVerificationEmailCode: null,
        OTPVerificationEmailCodeExpires: null,
      },
    });

    Logger.info(`OTP for ${sessionToken} verified`);
  }

  static async sendOTPPhone(sessionToken: string): Promise<void> {
    /*
        - Session Will not verify at this point
        - We will only send OTP to the phone
        - Be sure to check if the session the previous step is verified
        */

    Validater.validateToken(sessionToken);

    const session = await prisma.session.findUnique({
      where: {
        token: sessionToken,
      },
      select: {
        user: {
          select: {
            email: true,
            phone: true,
            userId: true,
            OTPEnabled: true,
            OTPCanUsePhone: true,
            lastEmailSent: true,
            lastPhoneSent: true,
          },
        },
        OTPNeeded: true,
      },
    });

    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }

    if (!session.user.OTPEnabled) {
      throw new Error("OTP_NOT_ENABLED");
    }

    if (!session.user.OTPCanUsePhone) {
      throw new Error("OTP_CANNOT_USE_PHONE");
    }

    if (!session.OTPNeeded) {
      throw new Error("OTP_NOT_NEEDED");
    }

    if (!session.user.phone) {
      throw new Error("PHONE_NOT_FOUND");
    }

    await this.rateLimiterPhone(session.user as User);

    const OTP = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`OTP for ${session.user.phone}: ${OTP}`);

    await prisma.session.update({
      where: {
        token: sessionToken,
      },
      data: {
        OTPVerificationPhoneCode: OTP,
        OTPVerificationPhoneCodeExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
      },
    });

    SendSMS.sendOTP(session.user.phone, OTP);
  }

  static async verifyOTPPhone(
    sessionToken: string,
    code: string,
  ): Promise<void> {

    Validater.validateToken(sessionToken);
    Validater.validateSixDigitCode(code);


    const session = await prisma.session.findUnique({
      where: {
        token: sessionToken,
        OTPVerificationPhoneCode: code,
        OTPVerificationPhoneCodeExpires: {
          gt: new Date(),
        },
      },
      select: {
        OTPVerificationPhoneCode: true,
        OTPVerificationPhoneCodeExpires: true,
      },
    });

    if (!session) {
      throw new Error("INVALID_OTP");
    }

    await prisma.session.update({
      where: {
        token: sessionToken,
      },
      data: {
        OTPNeeded: false,
        OTPVerificationPhoneCode: null,
        OTPVerificationPhoneCodeExpires: null,
      },
    });

    Logger.info(`OTP for ${sessionToken} verified`);
  }

  /* Updaters */
  static async sendEmailChangeEmail(
    user: User,
    newEmail: string,
  ): Promise<void> {

    Validater.validateEmail(newEmail);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.email === newEmail) {
      throw new Error("SAME_EMAIL");
    }

    if (await this.findUserByEmail(newEmail)) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    await this.rateLimiterEmail(user);

    const changeToken = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`Change token for ${user.email}: ${changeToken}`);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        emailChangeToken: changeToken,
        emailChangeTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
        emailChangeAddress: newEmail,
      },
    });

    SendMail.sendEmailChangeEmail(newEmail, changeToken);
  }

  static async verifyEmailChangeEmail(
    user: User,
    code: string,
  ): Promise<void> {

    Validater.validateSixDigitCode(code);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.emailChangeToken !== code) {
      throw new Error("INVALID_CHANGE_CODE");
    }

    if (
      typeof user.emailChangeTokenExpires === "undefined" ||
      user.emailChangeTokenExpires === null
    ) {
      throw new Error("CHANGE_CODE_EXPIRED");
    }

    if (new Date(user.emailChangeTokenExpires) < new Date()) {
      throw new Error("CHANGE_CODE_EXPIRED");
    }

    if (user.emailChangeAddress === null) {
      throw new Error("CHANGE_EMAIL_NOT_FOUND");
    }

    if (await this.findUserByEmail(user.emailChangeAddress)) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    SendMail.sendEmailChangedNotificationMail(
      user.email,
      user.emailChangeAddress,
    );

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        email: user.emailChangeAddress,
        emailChangeToken: null,
        emailChangeTokenExpires: null,
        emailChangeAddress: null,
      },
    });
  }

  static async sendPhoneChangeSMS(
    user: User,
    newPhone: number,
  ): Promise<void> {

    Validater.validatePhone(newPhone);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.phone === newPhone) {
      throw new Error("SAME_PHONE");
    }

    if (await this.findUserByPhone(newPhone)) {
      throw new Error("PHONE_ALREADY_EXISTS");
    }

    await this.rateLimiterPhone(user);

    const changeToken = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`Change token for ${user.phone}: ${changeToken}`);

    const updatedUser = await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        phoneChangeToken: changeToken,
        phoneChangeTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
        phoneChangeNumber: newPhone,
      },
    });

    SendSMS.sendPhoneChangeCode(newPhone, changeToken);
  }

  static async verifyPhoneChangeSMS(
    user: User,
    code: string,
  ): Promise<void> {

    Validater.validateSixDigitCode(code);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.phoneChangeToken !== code) {
      throw new Error("INVALID_CHANGE_CODE");
    }

    if (
      typeof user.phoneChangeTokenExpires === "undefined" ||
      user.phoneChangeTokenExpires === null
    ) {
      throw new Error("CHANGE_CODE_EXPIRED");
    }

    if (new Date(user.phoneChangeTokenExpires) < new Date()) {
      throw new Error("CHANGE_CODE_EXPIRED");
    }

    if (user.phoneChangeNumber === null) {
      throw new Error("CHANGE_PHONE_NOT_FOUND");
    }

    if (await this.findUserByPhone(user.phoneChangeNumber)) {
      throw new Error("PHONE_ALREADY_EXISTS");
    }

    if (user.phone) {
      SendSMS.sendPhoneChangedNotification(user.phone, user.phoneChangeNumber);
      Logger.info(
        `Phone changed Info SMS sent to ${user.phone}: ${user.phoneChangeNumber}`,
      );
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        phone: user.phoneChangeNumber,
        phoneChangeToken: null,
        phoneChangeTokenExpires: null,
        phoneChangeNumber: null,
      },
    });
  }

  static async sendForgotPasswordEmail(email: string): Promise<void> {

    Validater.validateEmail(email);

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    /*
        await this.rateLimiterEmail(user);
        */

    this.sendPasswordResetEmail(user);
  }

  static async verifyForgotPasswordEmail(
    email: string,
    code: string,
    password: string,
  ): Promise<void> {

    Validater.validateEmail(email);
    Validater.validatePassword(password);
    Validater.validateSixDigitCode(code);

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    if (user.passwordResetToken !== code) {
      throw new Error("INVALID_RESET_CODE");
    }

    if (
      typeof user.passwordResetTokenExpires === "undefined" ||
      user.passwordResetTokenExpires === null
    ) {
      throw new Error("RESET_CODE_EXPIRED");
    }

    if (new Date(user.passwordResetTokenExpires) < new Date()) {
      throw new Error("RESET_CODE_EXPIRED");
    }

    const hashedPassword = await this.hashPassword(password);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        password: hashedPassword,
        passwordResetToken: null,
        passwordResetTokenExpires: null,
      },
    });
  }

  /* Deleters */
  static async revokeSession(token: string): Promise<void> {

    Validater.validateToken(token);

    await prisma.session.delete({
      where: {
        token: token,
      },
    });
  }

  static async revokeAllSessionsbyUserId(user: User): Promise<void> {
    await prisma.session.deleteMany({
      where: {
        userId: user.userId,
      },
    });
  }

  static async loginOrRegisterWithOAuth(
    email: string,
    name: string,
    avatar?: string,
  ): Promise<any> {

    Validater.validateEmail(email);
    Validater.validateName(name);
    Validater.validateURL(avatar, true);

    const user = await this.findUserByEmail(email);

    if (!user) {
      const newUser = await prisma.user.create({
        data: {
          email: email,
          name: name,
          avatar: avatar,
          verified: true,
        },
      });

      const session = await this.createSession(newUser, false);



      return {
        token: session.token,
        OTP: {
          OTPNeeded: session.OTPNeeded,
          OTPCanUseEmail: session.OTPCanUseEmail,
          OTPCanUsePhone: session.OTPCanUsePhone,
        },
        user: {
          userId: newUser.userId,
          email: newUser.email,
          phone: newUser.phone,
          name: newUser.name,
          verified: newUser.verified,
        },
      };
    }

    this.checkIfUserIsVerified(user);

    const session = await this.createSession(user, true);

    //update user name and avatar
    const updatedUser = await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        name: name,
        //avatar: avatar ? avatar : user.avatar,
        userId: user.userId,
        email: user.email,
        phone: user.phone,
      },
    });

    return {
      token: session.token,
      user: {
        userId: updatedUser.userId,
        email: updatedUser.email,
        phone: updatedUser.phone,
        name: updatedUser.name,
        avatar: updatedUser.avatar,
        verified: updatedUser.verified,
      },
    };
  }

  static async callback(
    provider: string,
    code: string,
    state: string,
    scope?: string,
  ): Promise<any> {

    //TODO: OAUTH VALIDATION

    let user = null;

    const sqlInjectionRegex = /[\s\';"\\]/;

    /*
        if (sqlInjectionRegex.test(code) || sqlInjectionRegex.test(state) || (scope && sqlInjectionRegex.test(scope))) {
            throw new Error('INVALID_INPUT');
        }
        */

    switch (provider) {
      case "github":
        user = await this.callbackGithub(code, state);
        break;
      case "google":
        user = await this.callbackGoogle(code, state);
        break;
      default:
        throw new Error("PROVIDER_NOT_FOUND");
    }

    if (!user) {
      throw new Error("AUTH_FAILED");
    }

    return this.loginOrRegisterWithOAuth(user.email, user.name, user.avatar);
  }

  static async callbackGithub(code: string, state: string): Promise<any> {

    //TODO : VALIDATE STATE

    const { token_type, access_token } = await axios
      .post(
        "https://github.com/login/oauth/access_token",
        {
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code: code,
          scope: "user",
        },
        {
          headers: {
            Accept: "application/json",
          },
        },
      )
      .then((response) => {
        return response.data;
      })
      .catch((e) => {
        return null;
      });

    if (!access_token) {
      throw new Error("GITHUB_AUTH_FAILED");
    }

    const user = await axios
      .get("https://api.github.com/user", {
        headers: {
          authorization: `token ${access_token}`,
        },
      })
      .then((response) => {
        return response.data;
      })
      .catch((e) => {
        return null;
      });

    if (!user) {
      throw new Error("GITHUB_USER_NOT_FOUND");
    }

    //

    const temp_user = {
      email: user.email,
      name: user.name,
      avatar: user.avatar_url,
    };

    if (!user.email) {
      const emails = await axios
        .get("https://api.github.com/user/emails", {
          headers: {
            authorization: `token ${access_token}`,
          },
        })
        .then((response) => {
          return response.data;
        })
        .catch((e) => {
          return null;
        });

      if (!emails) {
        throw new Error("GITHUB_EMAIL_NOT_FOUND");
      }

      const primaryEmail = emails.find((email: any) => email.primary);

      if (!primaryEmail) {
        throw new Error("GITHUB_PRIMARY_EMAIL_NOT_FOUND");
      }

      temp_user.email = primaryEmail.email;
    }

    return temp_user;
  }

  static async callbackGoogle(code: string, state: string): Promise<any> {

    //TODO : VALIDATE STATE

    const { expires_in, access_token, refresh_token } = await axios
      .post(
        "https://oauth2.googleapis.com/token",
        {
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          code: code,
          redirect_uri:
            process.env.BACKEND_URL + "/api/v1/auth/callback/google",
          grant_type: "authorization_code",
        },
        {
          headers: {
            Accept: "application/json",
          },
        },
      )
      .then((response) => {
        return response.data;
      })
      .catch((e) => {
        return null;
      });

    if (!access_token) {
      throw new Error("GOOGLE_AUTH_FAILED");
    }

    // https://oauth2.googleapis.com/token

    const token_response = await axios
      .post(
        "https://oauth2.googleapis.com/token?refresh_token=" +
        access_token +
        "&client_id=" +
        process.env.GOOGLE_CLIENT_ID +
        "&client_secret=" +
        process.env.GOOGLE_CLIENT_SECRET +
        "&grant_type=refresh_token",
        {
          headers: {
            Accept: "application/json",
          },
        },
      )
      .then((response) => {
        return response.data;
      })
      .catch((e) => {
        return null;
      });

    const access_token_long = token_response.access_token;


    if (!access_token_long) {
      throw new Error("GOOGLE_AUTH_FAILED");
    }

    const user = await axios
      .get("https://www.googleapis.com/oauth2/v3/userinfo?alt=json", {
        headers: {
          authorization: `Bearer ${access_token_long}`,
        },
      })
      .then((response) => {
        return response.data;
      })
      .catch((e) => {
        return null;
      });

    if (!user) {
      throw new Error("GOOGLE_USER_NOT_FOUND");
    }

    const temp_user = {
      email: user.email,
      name: user.name,
      avatar: user.picture,
    };

    if (!user.email) {
      throw new Error("GOOGLE_EMAIL_NOT_FOUND");
    }

    return temp_user;
  }

  static async callbackFacebook(code: string, state: string): Promise<any> {
    //TODO
  }

  static async enableEmailOTP(user: User): Promise<void> {

    if (user.OTPCanUseEmail) {
      throw new Error("OTP_ALREADY_ENABLED");
    }

    //check if user has email
    if (!user.email) {
      throw new Error("EMAIL_NOT_FOUND");
    }

    //check if user is verified
    if (!user.verified) {
      throw new Error("USER_NOT_VERIFIED");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        OTPEnabled: true,
        OTPCanUseEmail: true,
      },
    });
  }

  static async enablePhoneOTP(user: User): Promise<void> {
    if (user.OTPCanUsePhone) {
      throw new Error("OTP_ALREADY_ENABLED");
    }

    //check if user has phone
    if (!user.phone) {
      throw new Error("PHONE_NOT_FOUND");
    }

    //check if user is verified
    if (!user.verified) {
      throw new Error("USER_NOT_VERIFIED");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        OTPEnabled: true,
        OTPCanUsePhone: true,
      },
    });
  }

  static async disableEmailOTP(user: User): Promise<void> {
    if (!user.OTPCanUseEmail) {
      throw new Error("OTP_ALREADY_DISABLED");
    }

    //if user has no phone otp enabled, disable otp
    if (!user.OTPCanUsePhone) {
      await prisma.user.update({
        where: {
          userId: user.userId,
        },
        data: {
          OTPEnabled: false,
          OTPCanUseEmail: false,
        },
      });
      return;
    } else {
      await prisma.user.update({
        where: {
          userId: user.userId,
        },
        data: {
          OTPCanUseEmail: false,
        },
      });
    }
  }

  static async disablePhoneOTP(user: User): Promise<void> {
    if (!user.OTPCanUsePhone) {
      throw new Error("OTP_ALREADY_DISABLED");
    }

    //if user has no email otp enabled, disable otp
    if (!user.OTPCanUseEmail) {
      await prisma.user.update({
        where: {
          userId: user.userId,
        },
        data: {
          OTPEnabled: false,
          OTPCanUsePhone: false,
        },
      });
      return;
    } else {
      await prisma.user.update({
        where: {
          userId: user.userId,
        },
        data: {
          OTPCanUsePhone: false,
        },
      });
    }
  }

  static async disableOTP(user: User): Promise<void> {

    if (!user.OTPEnabled) {
      throw new Error("OTP_ALREADY_DISABLED");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        OTPEnabled: false,
        OTPCanUseEmail: false,
        OTPCanUsePhone: false,
      },
    });

    return;
  }


  // This function is only for development purposes

  static async getTheEmailFromEnvAndMakeItAdmin(): Promise<void> {
    const email = process.env.SUPER_ADMIN_EMAIL;

    if (!email) {
      throw new Error("ADMIN_EMAIL_NOT_FOUND");
    }

    const user = await this.findUserByEmail(email);

    if (!user) {
      throw new Error("ADMIN_USER_NOT_FOUND");
    }

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        roles: {
          set: ["ADMIN", "USER"],
        },
        verified: true,
        verificationToken: null,
        verificationTokenExpires: null,
      },
    });
  }


  static checkIfUserHasRole(user: User, roles: string[] | string): boolean {

    Validater.validateRoles(roles);

    if (!user.roles) {
      return false;
    }

    if (!Array.isArray(roles)) {
      roles = [roles];
    }

    const result = roles.every(role => user.roles.includes(role));
    return result;
  }

  static async changePassword(user: User, oldPassword: string, newPassword: string): Promise<void> {

    const userFromDB = await prisma.user.findUnique({
      where: {
        userId: user.userId,
      },
    });

    if (!userFromDB) {
      throw new Error("USER_NOT_FOUND");
    }

    await this.comparePassword(oldPassword, userFromDB.password);

    const hashedPassword = await this.hashPassword(newPassword);

    //check if the user has the same password
    if (userFromDB.password === hashedPassword) {
      throw new Error("SAME_PASSWORD");
    }


    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        password: hashedPassword,
      },
    });

    return;

  }

  static async changeEmail(user: User, email: string): Promise<void> {

    Validater.validateEmail(email);

    const userFromDB = await prisma.user.findUnique({
      where: {
        userId: user.userId,
      },
    });

    if (!userFromDB) {
      throw new Error("USER_NOT_FOUND");
    }

    if (userFromDB.email === email) {
      throw new Error("SAME_EMAIL");
    }

    if (await this.findUserByEmail(email)) {
      throw new Error("EMAIL_ALREADY_EXISTS");
    }

    await this.rateLimiterEmail(userFromDB);

    const changeToken = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`Change token for ${userFromDB.email}: ${changeToken}`);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        emailChangeToken: changeToken,
        emailChangeTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
        emailChangeAddress: email,
      },
    });

    SendMail.sendEmailChangeEmail(email, changeToken);
  }

  static async changePhone(user: User, phone: number): Promise<void> {

    Validater.validatePhone(phone);

    const userFromDB = await prisma.user.findUnique({
      where: {
        userId: user.userId,
      },
    });

    if (!userFromDB) {
      throw new Error("USER_NOT_FOUND");
    }

    if (userFromDB.phone === phone) {
      throw new Error("SAME_PHONE");
    }

    if (await this.findUserByPhone(phone)) {
      throw new Error("PHONE_ALREADY_EXISTS");
    }

    await this.rateLimiterPhone(userFromDB);

    const changeToken = Math.floor(100000 + Math.random() * 900000).toString();

    Logger.info(`Change token for ${userFromDB.phone}: ${changeToken}`);

    await prisma.user.update({
      where: {
        userId: user.userId,
      },
      data: {
        phoneChangeToken: changeToken,
        phoneChangeTokenExpires: new Date(Date.now() + 1000 * 60 * 15), // 15 minutes
        phoneChangeNumber: phone,
      },
    });

    SendSMS.sendPhoneChangeCode(phone, changeToken);
  }

  static async listAllSessionsByUser(user: User): Promise<Session[]> {
    return await prisma.session.findMany({
      where: {
        userId: user.userId,
        expiresAt: {
          gt: new Date(),
        },
      },
    });
  }

  static async getSessionBySessionId(sessionId: string): Promise<Session> {
      
      Validater.validateID(sessionId);
  
      const session = await prisma.session.findFirst({
        where: {
          sessionId: sessionId,
        },
      });
  
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }
  
      return session;
    }
  

  static async revokeSessionByToken(token: string): Promise<void> {

    Validater.validateToken(token);

    await prisma.session.delete({
      where: {
        token: token,
      },
    });

    return;
  }


}
