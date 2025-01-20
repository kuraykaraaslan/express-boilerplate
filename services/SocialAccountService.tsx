import { UserSocialAccount, SocialProvider } from "@prisma/client";
import prisma from "@/libs/prisma";

// Other Services
import UserService from "./UserService";
import AuthService from "./AuthService";

export default class SocialAccountService {

    static async addOrUpdateSocialAccount(
        userId: string,
        provider: SocialProvider,
        providerId: string,
        accessToken?: string,
        refreshToken?: string,
        profilePicture?: string
    ): Promise<UserSocialAccount> {
        try {
            const existingAccount = await prisma.userSocialAccount.findUnique({
                where: { provider: provider, providerId: providerId },
            });

            if (existingAccount) {
                return await prisma.userSocialAccount.update({
                    where: { providerId: providerId },
                    data: {
                        accessToken,
                        refreshToken,
                        profilePicture,
                        updatedAt: new Date(),
                    },
                });
            }

            return await prisma.userSocialAccount.create({
                data: {
                    userId,
                    provider,
                    providerId,
                    accessToken,
                    refreshToken,
                    profilePicture,
                },
            });
        } catch (error: any) {
            throw new Error(`Error adding/updating social account: ${error.message}`);
        }
    }

    /**
     * Finds a user's social account by provider
     */
    static async getSocialAccountByProvider(
        provider: SocialProvider,
        providerId: string
    ): Promise<UserSocialAccount | null> {
        try {
            return await prisma.userSocialAccount.findUnique({
                where: {
                    provider,
                    providerId,
                },
            });
        } catch (error: any) {
            throw new Error(`Error fetching social account: ${error.message}`);
        }
    }

    /**
     * Links a social account to an existing user by email
     */
    static async linkSocialAccountToUser(
        email: string,
        provider: SocialProvider,
        providerId: string,
        accessToken?: string,
        refreshToken?: string,
        profilePicture?: string
    ): Promise<UserSocialAccount | null> {
        try {
            const user = await UserService.getByEmail(email);

            if (!user) {
                throw new Error("User not found");
            }

            return await this.addOrUpdateSocialAccount(
                user.userId,
                provider,
                providerId,
                accessToken,
                refreshToken,
                profilePicture
            );
        } catch (error: any) {
            throw new Error(`Error linking social account: ${error.message}`);
        }
    }

    /**
     * Unlinks a social account from a user
     */
    static async unlinkSocialAccount(
        userId: string,
        provider: SocialProvider
    ): Promise<void> {
        try {
            await prisma.userSocialAccount.deleteMany({
                where: { userId, provider },
            });
        } catch (error: any) {
            throw new Error(`Error unlinking social account: ${error.message}`);
        }
    }

    /**
     * Retrieves all social accounts linked to a user
     */
    static async getAllUserSocialAccounts(userId: string): Promise<UserSocialAccount[]> {
        try {
            return await prisma.userSocialAccount.findMany({
                where: { userId },
            });
        } catch (error: any) {
            throw new Error(`Error retrieving social accounts: ${error.message}`);
        }
    }


    /**
     * Deletes a social account by provider
     */
    static async deleteSocialAccountByProvider(
        provider: SocialProvider,
        providerId: string
    ): Promise<void> {
        try {
            await prisma.userSocialAccount.delete({
                where: { provider, providerId },
            });
        } catch (error: any) {
            throw new Error(`Error deleting social account: ${error.message}`);
        }
    }

    /**
     * Deletes all social accounts linked to a user
     */
    static async deleteAllUserSocialAccounts(userId: string): Promise<void> {
        try {
            await prisma.userSocialAccount.deleteMany({
                where: { userId },
            });
        } catch (error: any) {
            throw new Error(`Error deleting social accounts: ${error.message}`);
        }
    }

    /**
* Refreshes the access token for a social account if a refresh token is available
*/
    static async refreshAccessToken(provider: SocialProvider, refreshToken: string): Promise<string | null> {
        try {
            if (!refreshToken) throw new Error("Refresh token not provided");

            let newAccessToken: string | null = null;

            switch (provider) {
                case SocialProvider.GOOGLE:
                    newAccessToken = await SocialAccountService.refreshGoogleToken(refreshToken);
                    break;
                case SocialProvider.FACEBOOK:
                    newAccessToken = await SocialAccountService.refreshFacebookToken(refreshToken);
                    break;
                case SocialProvider.APPLE:
                    newAccessToken = await SocialAccountService.refreshAppleToken(refreshToken);
                    break;
                default:
                    throw new Error("Unsupported social provider");
            }

            return newAccessToken;
        } catch (error: any) {
            throw new Error(`Error refreshing access token: ${error.message}`);
        }
    }

    /*
    * Refreshes the access token for google
    */
    static async refreshGoogleToken(refreshToken: string): Promise<string> {
        try {
            const response = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: process.env.GOOGLE_CLIENT_ID as string,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                }),
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error_description || "Error refreshing token");
            }

            return data.access_token;
        } catch (error: any) {
            throw new Error(`Error refreshing Google token: ${error.message}`);
        }
    }

    /**
     * Refreshes the access token for facebook
     */
    static async refreshFacebookToken(refreshToken: string): Promise<string> {
        try {
            const response = await fetch("https://graph.facebook.com/v12.0/oauth/access_token", {
                method: "GET",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: process.env.FACEBOOK_APP_ID as string,
                    client_secret: process.env.FACEBOOK_APP_SECRET as string,
                    grant_type: "fb_exchange_token",
                    fb_exchange_token: refreshToken,
                }),
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || "Error refreshing token");
            }

            return data.access_token;
        } catch (error: any) {
            throw new Error(`Error refreshing Facebook token: ${error.message}`);
        }
    }

    /**
     * Refreshes the access token for apple
     */
    static async refreshAppleToken(refreshToken: string): Promise<string> {
        try {
            const response = await fetch("https://appleid.apple.com/auth/token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: new URLSearchParams({
                    client_id: process.env.APPLE_CLIENT_ID as string,
                    client_secret: process.env.APPLE_CLIENT_SECRET as string,
                    refresh_token: refreshToken,
                    grant_type: "refresh_token",
                }),
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error_description || "Error refreshing token");
            }

            return data.access_token;
        } catch (error: any) {
            throw new Error(`Error refreshing Apple token: ${error.message}`);
        }
    }

}
