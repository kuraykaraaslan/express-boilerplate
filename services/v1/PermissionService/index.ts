import { User, Tenant } from '@prisma/client';
import UserPermissionService from './UserPermissionService';
import TenantPermissionService from './TenantPermissionService';
import Logger from '../../../libs/logger';

export default class PermissionService {

    static readonly OPERATIONS = {
        CREATE: 'CREATE',
        READ: 'READ',
        UPDATE: 'UPDATE',
        DELETE: 'DELETE',
    };

    static readonly MODELS = ['User', 'Tenant'];

    static readonly MODEL_PRIMARY_KEY: Record<string, string> = {
        userId: 'User',
        tenantId: 'Tenant',
    };


    static determineModel(model: Record<string, any>): string {

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

    static async hasPermission(operator: User, subject: any, action: string): Promise<boolean> {

        // Check if the action is valid
        if (!Object.values(PermissionService.OPERATIONS).includes(action)) {
            throw new Error(`PermissionService: Invalid action: ${action}`);
        }

        const _operatorModel = PermissionService.determineModel(operator);

        // Operator had to be a valid model
        if (!PermissionService.MODELS.includes(_operatorModel)) {
            throw new Error('PermissionService: Operator must be valid model.');
        }

        // Operator had to be a user
        if (_operatorModel !== 'User') {
            throw new Error('PermissionService: Operator must be a user.');
        }

        // Subject had to be a user or tenant
        const _subjectModel = PermissionService.determineModel(subject);

        if (!PermissionService.MODELS.includes(_subjectModel)) {
            throw new Error('PermissionService: Subject must be valid model.');
        }

        // Check if the operator has permission to perform the action on the subject
        const _operatorModelUserRole = operator.userRole;

        if (_operatorModelUserRole === 'ADMIN') {
            return true;
        }

        if (_operatorModelUserRole === 'USER') {
            if (_subjectModel === 'User') {
                return await UserPermissionService.hasPermission(operator, subject, action);
            } else if (_subjectModel === 'Tenant') {
                return await TenantPermissionService.hasPermission(operator, subject, action);
            }
        }

        return false;
    }

    static async execute(operator: User, subject: any, action: string, callback: () => Promise<any>, fallback?: () => Promise<any>): Promise<any> {
        const hasPermission = await PermissionService.hasPermission(operator, subject, action);

        if (hasPermission) {
            Logger.info(`PermissionService: User ${operator.userId} has permission to perform ${action} on ${subject}`);
            return await callback();
        } else {
            Logger.warn(`PermissionService: User ${operator.userId} does not have permission to perform ${action} on ${subject}`);
            if (fallback) {
                return await fallback();
            } else {
                throw new Error(`PermissionService: User ${operator.userId} does not have permission to perform ${action} on ${subject}`);
            }
        }
    }

}
