/*
    This file is responsible for handling all the routes related to the tenant.
    If there is a route that is related to the blog, it should be here.
*/

import express from "express";
import BlogCategoryService from "../../services/Blog/CategoryService";
import BlogPostService from "../../services/Blog/PostService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Request from "../../request/Request";
import Response from "../../response/Response";
import authMiddleware from "../../middlewares/authMiddleware";

const BlogRouter = express.Router();

/*
    Those routes are public and can be accessed by anyone.  Sensible data should not be exposed here.
*/

BlogRouter.get("/category",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        let { page, pageSize } = req.query as any;

        if (!page) {
            page = 1;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        const categories = await BlogCategoryService.listCategories(page, pageSize);

        return res.status(200).json(categories);
    }),
);


BlogRouter.get("/category/:id",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;

        const category = await BlogCategoryService.getCategoryById(id);

        return res.status(200).json(category);
    }),
);

BlogRouter.post("/category",
    authMiddleware("ADMIN"),
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { name, slug, description } = req.body;

        const data = {
            name,
            slug,
            description,
        } as any;

        const category = await BlogCategoryService.createCategory(data);

        return res.status(201).json(category);
    }),
);


BlogRouter.get("/category/:id",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;

        const category = await BlogCategoryService.getCategoryById(id);

        return res.status(200).json(category);
    }),
);

BlogRouter.put("/category/:id",
    authMiddleware("ADMIN"),
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;
        const { name, slug, description } = req.body;

        const data = {
            name,
            slug,
            description,
        } as any;

        const category = await BlogCategoryService.updateCategory(id, data);

        return res.status(200).json(category);
    }),
);

BlogRouter.get("/category/:id/posts",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;
        let { page, pageSize } = req.query as any;

        if (!page) {
            page = 1;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        const posts = await BlogPostService.listPostsByCategory(id, page, pageSize);

        return res.status(200).json(posts);
    }),
);

BlogRouter.delete("/category/:id",
    authMiddleware("ADMIN"),
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;

        const category = await BlogCategoryService.deleteCategory(id);

        return res.status(200).json(category);
    }),
);

BlogRouter.get("/post",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        let { page, pageSize } = req.query as any;

        if (!page) {
            page = 1;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        const posts = await BlogPostService.listPosts(page, pageSize);

        return res.status(200).json(posts);
    }),
);

BlogRouter.get("/post/:id",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { id } = req.params;

        const post = await BlogPostService.getPostById(id);

        return res.status(200).json(post);
    }),
);





export default BlogRouter;