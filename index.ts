import express from 'express';
import { moduleApi } from './router/dispatch';
import { boot } from './boot';
import { mountPages } from './pages';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Every core module API (/api/*, /tenant/{id}/api/*). Before any body parser: the handlers read the body themselves.
app.use(moduleApi);

// Pages: server-rendered EJS on the vendored kui-ejs partials.
mountPages(app);

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  boot()
    .then(() => app.listen(port, () => console.log(`Server is running on port ${port}`)))
    .catch((error) => { console.error('boot failed', error); process.exit(1); });
}

export default app;
