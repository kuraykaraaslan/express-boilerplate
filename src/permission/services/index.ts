import UserPermissionService from './UserPermissionService';
import Logger from '../../shared/libs/logger';
import { PermissionMessages } from '../dictionaries';
import TenantPermissionService from './TenantPermissionService';
import { Request } from 'express';

export default class PermissionService {

    static readonly MODELS = ['User', 'Tenant'];

    static readonly MODEL_PRIMARY_KEY: Record<string, string> = {
        userId: 'User',
        tenantId: 'Tenant',
    };


    static getModelByPrimaryKey(model: Record<string, any>): string {

        if (typeof model !== 'object' || model === null) {
            throw new Error('PermissionService: Invalid model. Expected a non-null object.');
        }

        for (const key of Object.keys(model)) {
            const modelName = PermissionService.MODEL_PRIMARY_KEY[key];
            if (modelName) {
                return modelName;
            }
        }

        throw new Error('PermissionService: Could not determine model from provided object.');
    }

    static async execute({
        request,
        subject,
        action,
        callback,
        fallback,
    }: {
        request: Request;
        subject: any;
        action: any;
        callback: (data: any) => Promise<any>;
        fallback?: (data: any) => Promise<any>;
    }): Promise<any> {

        let subjectModel ;

        // Subject can be a string or an object
        if (typeof subject === 'string') {
            subjectModel = PermissionService.MODELS.find(model => model === subject);
        } else if (typeof subject === 'object') {
            subjectModel = PermissionService.getModelByPrimaryKey(subject);
        } else {
            throw new AppError(PermissionMessages.INVALID_SUBJECT, 400);
        }
        
        // Check if the operator is admin
        if (request.user!.userRole === 'ADMIN') {
            Logger.info(PermissionMessages.ADMIN_PERMISSION_GRANTED);
            return await callback(subject);
        }

        switch (subjectModel ) {
            case 'User':
                return await UserPermissionService.execute({
                    operator: request.user!,
                    subject,
                    action,
                    callback,
                    fallback,
                });
            case 'Tenant':
                return await TenantPermissionService.execute({
                    operator : request.tenantUser!,
                    subject,
                    action,
                    callback,
                    fallback,
                });
            default:
                throw new AppError(PermissionMessages.INVALID_MODEL, 400);
        }

    }

}
