
import axios, { AxiosInstance } from 'axios';

/**
 * Service class for handling PayPal-related payment operations,
 * including order validation and refund processing.
 */
export default class PaypalService {
    private static PAYPAL_ACCESS_TOKEN: string | null = null;
    private static PAYPAL_ACCESS_TOKEN_EXPIRES: Date | null = null;
    private static readonly PAYPAL_API_URL = process.env.PAYPAL_API_URL || 'https://api-m.sandbox.paypal.com';

    private static axiosInstance: AxiosInstance = PaypalService.initializeAxios();
    
    private static initializeAxios(): AxiosInstance {
        const instance = axios.create({
            baseURL: this.PAYPAL_API_URL,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            }
        });

        instance.interceptors.request.use(async config => {
            config.headers['Authorization'] = `Bearer ${await this.getAccessToken()}`;
            config.headers['Content-Type'] = 'application/json';
            return config;
        }, error => Promise.reject(error));

        return instance;
    }

    private static async getAccessToken(): Promise<string> {
        if (
            this.PAYPAL_ACCESS_TOKEN &&
            this.PAYPAL_ACCESS_TOKEN_EXPIRES &&
            this.PAYPAL_ACCESS_TOKEN_EXPIRES > new Date()
        ) {
            return this.PAYPAL_ACCESS_TOKEN;
        }

        const { PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET } = process.env;
        const credentials = Buffer.from(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`).toString('base64');

        try {
            const res = await axios.post(
                `${this.PAYPAL_API_URL}/v1/oauth2/token`,
                'grant_type=client_credentials',
                {
                    headers: {
                        Authorization: `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                }
            );
            this.PAYPAL_ACCESS_TOKEN = res.data.access_token;
            this.PAYPAL_ACCESS_TOKEN_EXPIRES = new Date(Date.now() + res.data.expires_in * 1000);
            return res.data.access_token;
        } catch (error) {
            throw new Error('Failed to obtain PayPal access token');
        }
    }

    
    static async getPaymentStatus(paypalCaptureId: string): Promise<any> {
        try {
            const response = await this.axiosInstance.get(`/v2/checkout/orders/${paypalCaptureId}`);
            return response.data;
        } catch (error) {
            throw new Error('Failed to get payment status');
        }
    }
}
