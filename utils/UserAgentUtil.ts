import geoip from "geoip-lite";
import { Request } from "express";

type OSName =
    | 'Windows'
    | 'macOS'
    | 'Android'
    | 'iOS'
    | 'Chrome OS'
    | 'Linux'
    | 'Unix'
    | 'Unknown';

type DeviceType =
    | 'Mobile'
    | 'Tablet'
    | 'Desktop';

type BrowserName =
    | 'Chrome'
    | 'Firefox'
    | 'Safari'
    | 'Edge'
    | 'IE'
    | 'Opera'
    | 'Postman'
    | 'Unknown';

type GeoLocation = {
    city: string | null;
    state: string | null;
    country: string | null;
};

type OSPattern = {
    pattern: RegExp;
    name: OSName;
};


type UserAgentData = {
    os: string | null;
    device: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    ip?: string | null;
    browser?: string | null;
}


export default class UserAgentUtil {
    private static readonly osPatterns: OSPattern[] = [
        { pattern: /Windows NT/i, name: 'Windows' },
        { pattern: /Mac OS X/i, name: 'macOS' },
        { pattern: /Android/i, name: 'Android' },
        { pattern: /(iPhone|iPad|iPod)/i, name: 'iOS' },
        { pattern: /CrOS/i, name: 'Chrome OS' },
        { pattern: /Linux/i, name: 'Linux' },
        { pattern: /X11/i, name: 'Unix' }   
    ];

    public static getOS(userAgent: string): string {
        for (const { pattern, name } of UserAgentUtil.osPatterns) {
            if (pattern.test(userAgent)) {
                return name;
            }
        }
        return 'Unknown';
    }

    public static getDeviceType(userAgent: string): DeviceType {
        if (/iPad/i.test(userAgent)) return 'Tablet';

        if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) {
            return 'Tablet';
        }

        const mobilePattern = /(iPhone|iPod|Mobile|Android.*Mobile|BlackBerry|Windows Phone)/i;
        if (mobilePattern.test(userAgent)) {
            return 'Mobile';
        }

        return 'Desktop';
    }

    public static getGeoLocation(ip: string): GeoLocation {
        const lookup = geoip.lookup(ip);

        return {
            city: lookup?.city ?? null,
            state: lookup?.region ?? null,
            country: lookup?.country ?? null
        };
    }

    public static getBrowser(userAgent: string): string {
        if (/Edge/i.test(userAgent)) return 'Edge';
        if (/Chrome/i.test(userAgent)) return 'Chrome';
        if (/Firefox/i.test(userAgent)) return 'Firefox';
        if (/Safari/i.test(userAgent)) return 'Safari';
        if (/MSIE/i.test(userAgent)) return 'IE';
        if (/Opera/i.test(userAgent)) return 'Opera';
        if (/Postman/i.test(userAgent)) return 'Postman';
        return 'Unknown';
    }

    public static parseRequest(request: Request<any>): UserAgentData {
        const userAgent = request.headers['user-agent'];
        const ip = request.headers['x-real-ip'] || request.headers['x-forwarded-for'] || request.connection.remoteAddress;
        return UserAgentUtil.parse(userAgent, ip as string);
    }

    public static parse(userAgent?: string, ip?: string): UserAgentData {

        const geo = ip ? UserAgentUtil.getGeoLocation(ip) : null;

        return {
            os: userAgent ? UserAgentUtil.getOS(userAgent) : 'Unknown',
            device: userAgent ? UserAgentUtil.getDeviceType(userAgent) : 'Desktop',
            city: geo?.city ?? "Unknown",
            state: geo?.state ?? "Unknown",
            country: geo?.country ?? "Unknown",
            ip: ip ?? "Unknown",
            browser: userAgent ? UserAgentUtil.getBrowser(userAgent) : 'Unknown'
        };
    }
}