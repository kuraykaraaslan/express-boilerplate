import { Wallet, PrismaClient } from "@prisma/client";
import SolanaWalletService from "./SolanaWalletService";

const prisma = new PrismaClient();

export default class WalletService {

    static validateNetwork(network: string): void {
        const status = network === 'ETH' || network === 'BTC' || network === 'SOL';

        if (!status) {
            throw new Error('INVALID_NETWORK');
        }

    }

    static async listAllWallets(page: number, pageSize: number, network: string): Promise<any> {

        const skip = page * pageSize;
        const take = pageSize;

        const query = await prisma.$transaction(
            [
                prisma.wallet.findMany({
                    skip,
                    take,
                    where: {
                        network: network ? network !== 'ALL' ? network : undefined : undefined
                    }
                }),
                prisma.wallet.count({
                    where: {
                        network: network ? network !== 'ALL' ? network : undefined : undefined
                    }
                }),
            ]
        );

        return {
            wallets: query[0],
            total: query[1],
            page,
            pageSize,
            network: network || 'ALL'
        };
    }

    static async getWallet(walletId: string): Promise<any> {
        return await prisma.wallet.findUnique({
            where: {
                walletId: walletId
            }
        });
    }

    static async getWalletByAddress(address: string): Promise<any> {

        return await prisma.wallet.findFirst({
            where: {
                address: address
            }
        });
    }

    static async getWalletsByUserId(userId: string): Promise<any> {

        return await prisma.wallet.findMany({
            where: {
                userId: userId
            },
            select: {
                walletId: true,
                address: true,
                network: true,
                userId: true
            }
        });
    }

    static async getWalletsByUserIdAndNetwork(userId: string, network: string): Promise<any> {

        return await prisma.wallet.findMany({
            where: {
                userId: userId,
                network: network
            },
            select: {
                walletId: true,
                address: true,
                network: true,
                userId: true
            }
        });
    }

    static async createWalletWithUserAndNetwork(userId: string, network: string): Promise<any> {

        this.validateNetwork(network);

        const existingWallet = await this.getWalletsByUserIdAndNetwork(userId, network);

        if (existingWallet.length > 0) {
            throw new Error('WALLET_EXISTS');
        }

        let wallet: any;

        switch (network) {
            case 'SOL':
                wallet = await SolanaWalletService.generateWallet();
                break;
            default:
                throw new Error('NETWORK_NOT_SUPPORTED');
        }

        if (!wallet) {
            throw new Error('WALLET_CREATION_FAILED');
        }

        var created = await prisma.wallet.create({
            data: {
                memonic: wallet.memonic,
                address: wallet.address,
                privateKey: wallet.privateKey,
                network: network,
                userId: userId
            }
        }) ;

        //remove the private key from the response
        var sensitiveDataHidden = {
            walletId: created.walletId,
            address: created.address,
            network: created.network,
            userId: created.userId
        };

        return sensitiveDataHidden;
        
    }

    /* Transaction related methods */
    static async sendTransaction(fromWalletId: string, toAddress: string, amount: number): Promise<any> {

        const fromWallet = await this.getWallet(fromWalletId);

        if (!fromWallet) {
            throw new Error('WALLET_NOT_FOUND');
        }

        const toWallet = await this.getWalletByAddress(toAddress);

        if (!toWallet) {
            throw new Error('TO_WALLET_NOT_FOUND');
        }

        if (fromWallet.network !== toWallet.network) {
            throw new Error('DIFFERENT_NETWORKS');
        }

        if (amount <= 0) {
            throw new Error('INVALID_AMOUNT');
        }

        switch (fromWallet.network) {
            case 'SOL':
                await SolanaWalletService.sendSolanaTransaction(fromWallet.privateKey, toAddress, amount);
                break;
            default:
                throw new Error('NETWORK_NOT_SUPPORTED');
        }

        return;

    }

    static async getBalance(walletId: string): Promise<any> {
        const wallet = await this.getWallet(walletId);

        if (!wallet) {
            throw new Error('WALLET_NOT_FOUND');
        }

        switch (wallet.network) {
            case 'SOL':
                return await SolanaWalletService.getSolanaBalance(wallet.address);
            default:
                throw new Error('NETWORK_NOT_SUPPORTED');
        }
    }

}

