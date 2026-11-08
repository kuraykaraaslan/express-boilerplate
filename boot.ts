// What next-boilerplate's instrumentation.ts does once at boot, without the install-config check (config/ belongs to the install).
export async function boot(): Promise<void> {
  const { default: Logger } = await import('@kuraykaraaslan-labs/logger');

  const { announceInstallAccess } = await import('@kuraykaraaslan-labs/auth_abac/server/auth_abac.install-access');
  announceInstallAccess();

  const { default: ObservabilityService } = await import('@kuraykaraaslan-labs/observability');
  await ObservabilityService.init();

  // The limiter reads the dispatcher's answers (each address's 401 / 403 / 404s) as its misbehaviour signal.
  const { default: Limiter } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service.next');
  Limiter.watchAnswers();
  void import('@kuraykaraaslan-labs/limiter/server/limiter.ip-ban-store')
    .then((store) => store.rebuildIfFlushed())
    .catch(() => undefined);

  const { bootRuntime } = await import('@kuraykaraaslan-labs/common/server/worker-bootstrap');
  const { withLeader } = await import('@kuraykaraaslan-labs/process_host/server/leader-lock');
  await bootRuntime(Logger, 'express', { leader: (job, run) => withLeader('worker', job, run) });
}
