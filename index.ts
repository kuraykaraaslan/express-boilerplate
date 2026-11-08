import express from 'express';
import { moduleApi } from './router/dispatch';
import { boot } from './boot';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

// Every core module API (/api/*, /tenant/{id}/api/*). Before any body parser: the handlers read the body themselves.
app.use(moduleApi);

// Pages are server-rendered EJS (kui-ejs) and are mounted here.

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  boot()
    .then(() => app.listen(port, () => console.log(`Server is running on port ${port}`)))
    .catch((error) => { console.error('boot failed', error); process.exit(1); });
}

export default app;
