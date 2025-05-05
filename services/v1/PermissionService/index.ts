import UserPermissionService from './UserPermissionService';
import Logger from '../../../libs/logger';
import { PermissionMessages } from '../../../dictionaries/PermissionMessages';

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
        operator,
        subject,
        action,
        callback,
        fallback
    }: {
        operator: any;
        subject: any;
        action: any;
        callback: (data: any) => Promise<any>;
        fallback?: (data: any) => Promise<any>;
    }): Promise<any> {

        // Check if the operator is valid
        if (!operator || !operator.userId) {
            throw new AppError(PermissionMessages.INVALID_OPERATOR, 401);
        }

        const subjectModel  = this.getModelByPrimaryKey(subject);

        // Check if the operator is admin
        if (operator.userRole === 'ADMIN') {
            Logger.info(PermissionMessages.ADMIN_PERMISSION_GRANTED);
            return await callback(subject);
        }

        switch (subjectModel ) {
            case 'User':
                return await UserPermissionService.execute({
                    operator,
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
