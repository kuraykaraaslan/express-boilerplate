export default interface AuthRegisterRequest {
    email: string;
    password: string;
    phone?: string;
    name?: string;    
}