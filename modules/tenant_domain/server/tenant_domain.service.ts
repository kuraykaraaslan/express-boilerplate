import TenantDomainCrudService from './tenant_domain.crud.service';
import TenantDomainDnsService from './tenant_domain.dns.service';
import SSLProvisioningService from './ssl_provisioning.service';
import TenantDomainReportService from './tenant_domain.report.service';
import { managedBases } from './tenant_domain.base-domains';
import { hostMoveFor } from './tenant_domain.host-moves';

export { TenantDomainCrudService, TenantDomainDnsService, SSLProvisioningService, TenantDomainReportService };

export default class TenantDomainService {

  // CRUD
  static getByTenantId        = TenantDomainCrudService.getByTenantId.bind(TenantDomainCrudService);
  static getById              = TenantDomainCrudService.getById.bind(TenantDomainCrudService);
  static getByDomain          = TenantDomainCrudService.getByDomain.bind(TenantDomainCrudService);
  static getPrimaryByTenantId = TenantDomainCrudService.getPrimaryByTenantId.bind(TenantDomainCrudService);
  static getFreeSubdomainByTenantId = TenantDomainCrudService.getFreeSubdomainByTenantId.bind(TenantDomainCrudService);
  static getOverview          = TenantDomainCrudService.getOverview.bind(TenantDomainCrudService);
  static create               = TenantDomainCrudService.create.bind(TenantDomainCrudService);
  static update               = TenantDomainCrudService.update.bind(TenantDomainCrudService);
  static delete               = TenantDomainCrudService.delete.bind(TenantDomainCrudService);

  // DNS verification
  static getVerificationInfo  = TenantDomainDnsService.getVerificationInfo.bind(TenantDomainDnsService);
  static initiateVerification = TenantDomainDnsService.initiateVerification.bind(TenantDomainDnsService);
  static verifyDomain         = TenantDomainDnsService.verifyDomain.bind(TenantDomainDnsService);

  // SSL observability
  static recheckDomainSsl     = SSLProvisioningService.recheckDomain.bind(SSLProvisioningService);

  // Reporting
  static getReport            = TenantDomainReportService.getReport.bind(TenantDomainReportService);

  // Managed base domains (phase 56): what the proxy's serving rule reads, cached in process
  static managedBases         = managedBases;
  // Hosts a tenant left (phase 56, D347): what the proxy redirects an old host to
  static hostMoveFor          = hostMoveFor;
}
