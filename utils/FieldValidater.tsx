export default class FieldValidater {
    static emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    static passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/;

    /**
     * Validates if the provided email matches the email regex pattern.
     * @param email - The email string to validate.
     * @returns `true` if valid, `false` otherwise.
     */
    static isEmail(email: string | undefined | null): boolean {
        if (!email || typeof email !== "string") return false;
        return this.emailRegex.test(email);
    }

    /**
     * Validates if the provided password matches the password regex pattern.
     * @param password - The password string to validate.
     * @returns `true` if valid, `false` otherwise.
     */
    static isPassword(password: string | undefined | null): boolean {
        if (!password || typeof password !== "string") return false;
        return this.passwordRegex.test(password);
    }

    /**
     * Validates a string against a custom regex pattern.
     * @param value - The string to validate.
     * @param pattern - The regex pattern to use for validation.
     * @returns `true` if the value matches the pattern, `false` otherwise.
     */
    static validateWithRegex(value: string | undefined | null, pattern: RegExp): boolean {
        if (!value || typeof value !== "string") return false;
        return pattern.test(value);
    }
}
