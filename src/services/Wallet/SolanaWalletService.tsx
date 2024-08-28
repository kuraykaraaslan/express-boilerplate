import axios from "axios";

export class SolanaWalletService {
    static axios = axios.create({
        baseURL: process.env.TATUM_API_URL,
        headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.TATUM_API_KEY,
        },
    });

    static async generateWallet() : Promise<any> {
        try {
            const response = await this.axios.get(`/v3/solana/wallet`);
            return response.data;
        } catch (error) {
            return null;
        }
    }

    static async getWalletBalance(address: string) : Promise<any> {
        try {
            const response = await this.axios.get(`/v3/solana/account/${address}`);
            return response.data;
        } catch (error) {
            return null;
        }
    }

    static async sendSolanaTransaction(fromPrivateKey: string, to: string, amount: number) : Promise<any> {
        try {
            const response = await this.axios.post(`/v3/solana/transaction`, {
                fromPrivateKey,
                to,
                amount
            });
            return response.data;
        } catch (error) {
            return null;
        }
    }
   
}

export default SolanaWalletService;