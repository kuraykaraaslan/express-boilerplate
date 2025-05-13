import axios, { AxiosInstance } from 'axios';

export default class StripeService {
    private static readonly STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY!;
    private static readonly STRIPE_API_URL = 'https://api.stripe.com/v1';

    private static axiosInstance: AxiosInstance = StripeService.initializeAxios();

    private static initializeAxios(): AxiosInstance {
        return axios.create({
            baseURL: this.STRIPE_API_URL,
            headers: {
                Authorization: `Bearer ${this.STRIPE_SECRET_KEY}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
    }

    public static getAxiosInstance(): AxiosInstance {
        if (!this.axiosInstance) {
            this.axiosInstance = this.initializeAxios();
        }
        return this.axiosInstance;
    }

}
