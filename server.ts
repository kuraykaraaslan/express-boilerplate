import app from "./index";
import { SystemDataSource } from "@/modules/db/db.system";
import { env } from "@/modules/env";

const port = env.PORT;

SystemDataSource.initialize()
  .then(() => {
    console.log('TypeORM connection ready');
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((error: any) => console.error('TypeORM connection error:', error));
