import app from "./index";
import { AppDataSource } from "@/modules_express/db";
import { env } from "@/modules_express/env";

const port = env.PORT;

AppDataSource.initialize()
  .then(() => {
    console.log('TypeORM connection ready');
    app.listen(port, () => {
      console.log(`Server is running on port ${port}`);
    });
  })
  .catch((error: any) => console.error('TypeORM connection error:', error));
