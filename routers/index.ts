import { Router } from "express";
import V1Router from "./v1";
import ViewRouter from "./ViewRouter";
import "../bootstrap/global-errors";

const IndexRouter = Router();

IndexRouter.get("/", (req : any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    return res.send({
        message: "Welcome to the Express Boilerplate",
        version: "2.0.0",
        developer: "Kuray Karaaslan",
        repo: "github.com/kuraykaraaslan/express-boilerplate",
        github: "github.com/kuraykaraaslan",
        linkedin: "linkedin.com/in/kuraykaraaslan",
    });
});


IndexRouter.use("/api/v1", V1Router);
IndexRouter.use("/views", ViewRouter);

IndexRouter.get("/", (req : any, res: any) => {
    res.setHeader("Content-Type", "application/json");
    return res.send({
        message: "Welcome to the Express Boilerplate",
        version: "1.0.6",
        developer: "Kuray Karaaslan",
        repo: "github.com/kuraykaraaslan/express-boilerplate",
        github: "github.com/kuraykaraaslan",
        linkedin: "linkedin.com/in/kuraykaraaslan",
    });
});  




export default IndexRouter;